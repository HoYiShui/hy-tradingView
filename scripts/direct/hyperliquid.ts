import { createHyperliquidClient } from "../../apps/server/src/hyperliquid/client.js";
import type { ExchangeCredentials } from "../../apps/server/src/config.js";
import type { Direct, DirectPosition } from "./types.js";

type Hyperliquid = Extract<ExchangeCredentials, { exchange: "hyperliquid" }>;
type Json = Record<string, unknown>;

const num = (v: unknown) => Number(v);
const rows = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

function signedUsd(d: Json, address: string): number {
  switch (d["type"]) {
    case "deposit":
      return num(d["usdc"]);
    case "withdraw":
      return -(num(d["usdc"]) + num(d["fee"]));
    case "send":
      return String(d["destination"]).toLowerCase() === address.toLowerCase() ? num(d["usdcValue"]) : -(num(d["usdcValue"]) + num(d["fee"]));
    default:
      return 0;
  }
}

export function directHyperliquid({ apiUrl, address }: Hyperliquid): Direct {
  const client = createHyperliquidClient({ baseUrl: apiUrl });
  const dexs = async (): Promise<string[]> => {
    const all = (await client.info({ type: "perpDexs" })) as (Json | null)[];
    return ["", ...all.flatMap((d) => (d !== null && typeof d["name"] === "string" ? [d["name"]] : []))];
  };
  const states = async () =>
    Promise.all((await dexs()).map(async (dex) => ({ dex, state: (await client.info({ type: "clearinghouseState", user: address, dex })) as Json })));

  return {
    secrets: [address, address.toLowerCase()],
    async equity() {
      const abstraction = await client.info({ type: "userAbstraction", user: address });
      const spot = (await client.info({ type: "spotClearinghouseState", user: address })) as { balances: Json[] };
      const unknown = spot.balances.filter((b) => b["coin"] !== "USDC" && num(b["total"]) !== 0);
      if (unknown.length > 0) throw new Error(`direct equity cannot price spot ${unknown.map((b) => String(b["coin"])).join(",")}`);
      const usdc = spot.balances.filter((b) => b["coin"] === "USDC").reduce((s, b) => s + num(b["total"]), 0);
      if (abstraction === "unifiedAccount" || abstraction === "portfolioMargin") return usdc;
      const perp = (await states()).reduce((s, { state }) => s + num((state["marginSummary"] as Json)["accountValue"]), 0);
      return perp + usdc;
    },
    async positions() {
      const mids = (await client.info({ type: "allMids" })) as Record<string, string>;
      const out: DirectPosition[] = [];
      for (const { state } of await states()) {
        for (const a of rows(state["assetPositions"])) {
          const p = a["position"] as Json;
          const symbol = String(p["coin"]);
          out.push({
            symbol,
            quantity: num(p["szi"]),
            entryPrice: num(p["entryPx"]),
            markPrice: num(mids[symbol] ?? p["entryPx"]),
            notional: Math.abs(num(p["positionValue"])),
            openPnl: num(p["unrealizedPnl"]),
          });
        }
      }
      return out;
    },
    async openOrderCount() {
      let n = 0;
      for (const dex of await dexs()) n += rows(await client.info({ type: "frontendOpenOrders", user: address, dex })).length;
      return n;
    },
    async fillCount(limit) {
      const fills = rows(await client.info({ type: "userFills", user: address }));
      const perp = fills.filter((f) => !String(f["coin"]).startsWith("@") && !String(f["coin"]).includes("/"));
      return Math.min(limit, perp.length);
    },
    async transfers() {
      const updates = rows(await client.info({ type: "userNonFundingLedgerUpdates", user: address, startTime: 0 }));
      const byType = new Map<string, { count: number; usd: number }>();
      for (const u of updates) {
        const d = u["delta"] as Json;
        const type = String(d["type"]);
        const usd = signedUsd(d, address);
        const row = byType.get(type) ?? { count: 0, usd: 0 };
        byType.set(type, { count: row.count + 1, usd: row.usd + usd });
      }
      return [...byType].map(([type, v]) => ({ type, ...v }));
    },
    async latestCandle(symbol, interval) {
      const now = Date.now();
      const bars = rows(await client.info({ type: "candleSnapshot", req: { coin: symbol, interval, startTime: now - 2 * 3_600_000, endTime: now } }));
      const last = bars.at(-1);
      if (last === undefined) throw new Error("no direct candle");
      return { start: num(last["t"]), close: num(last["c"]) };
    },
  };
}
