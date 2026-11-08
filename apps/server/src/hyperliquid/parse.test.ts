import { describe, expect, it } from "vitest";
import { reduceLedger, sortLedger } from "@hy/replay";
import { Millis, type LedgerEvent } from "@hy/types";
import allMids from "../../../../scripts/samples-hyperliquid/allMids.json";
import candles from "../../../../scripts/samples-hyperliquid/candle-1h.json";
import clearinghouse from "../../../../scripts/samples-hyperliquid/clearinghouseState.json";
import historicalOrders from "../../../../scripts/samples-hyperliquid/historicalOrders.json";
import perpDexs from "../../../../scripts/samples-hyperliquid/perpDexs.json";
import spotMeta from "../../../../scripts/samples-hyperliquid/spotMeta.json";
import spotState from "../../../../scripts/samples-hyperliquid/spotClearinghouseState.json";
import userFills from "../../../../scripts/samples-hyperliquid/userFills.json";
import userFunding from "../../../../scripts/samples-hyperliquid/userFunding.json";
import variants from "../../../../scripts/samples-hyperliquid/variants.json";
import {
  dexOf,
  parseAbstraction,
  parseCandles,
  parseFills,
  parseFunding,
  parseMids,
  parseOpenOrders,
  parseOrderHistory,
  parsePerpDexNames,
  parsePerpState,
  parseSpotPricing,
  parseSpotState,
} from "./parse.js";
import { buildSnapshot } from "./snapshot.js";

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

describe("account state", () => {
  it("treats a unified account as one pool", () => {
    expect(parseAbstraction("unifiedAccount")).toBe("pooled");
    expect(parseAbstraction("portfolioMargin")).toBe("pooled");
    for (const mode of ["default", "disabled", "dexAbstraction", null]) expect(parseAbstraction(mode)).toBe("perp");
    expect(() => parseAbstraction("mystery")).toThrow();
  });

  it("reads a flat perp state and the spot pool", () => {
    const perp = parsePerpState(clearinghouse);
    expect(perp.positions).toEqual([]);
    expect(perp.accountValue).toBe(0);
    const spot = parseSpotState(spotState);
    expect(spot.balances).toEqual([{ coin: "USDC", token: 0, total: 133.384927, hold: 0 }]);
    expect(spot.availableAfterMaintenance.get(0)).toBe(133.384927);
  });

  it("takes equity from the spot pool for a unified account", () => {
    const snapshot = buildSnapshot({
      asOf: Millis.parse(1),
      mode: "pooled",
      perps: [parsePerpState(clearinghouse)],
      spot: parseSpotState(spotState),
      usdPerUnit: () => 1,
      openOrders: [],
    });
    expect(snapshot.exchange).toBe("hyperliquid");
    expect(snapshot.account.equity).toBeCloseTo(133.384927, 6);
    expect(snapshot.account.availableEquity).toBeCloseTo(133.384927, 6);
    expect(snapshot.account.lockedEquity).toBe(0);
    expect(snapshot.metrics.leverage).toBe(0);
    expect(snapshot.account.leverageLimit).toBeNull();
  });

  it("adds perp account value to spot for a standard account", () => {
    const perp = parsePerpState({ ...clearinghouse, marginSummary: { ...clearinghouse.marginSummary, accountValue: "50.0" }, withdrawable: "50.0" });
    const snapshot = buildSnapshot({ asOf: Millis.parse(1), mode: "perp", perps: [perp], spot: parseSpotState(spotState), usdPerUnit: () => 1, openOrders: [] });
    expect(snapshot.account.equity).toBeCloseTo(183.384927, 6);
  });
});

describe("positions", () => {
  it("reads an isolated position with its own leverage, liquidation price and funding sign", () => {
    const [p] = parsePerpState({ ...clearinghouse, assetPositions: variants.iso.assetPositions }).positions;
    expect(p).toMatchObject({
      symbol: "SOL",
      direction: "long",
      quantity: 212.73,
      entryPrice: 89.8758,
      liquidationPrice: 87.5580769653,
      margin: "isolated",
      leverage: 20,
      openPnl: -65.918507,
      breakEvenPrice: null,
    });
    expect(p?.cumulativeFunding).toBeCloseTo(0.182009, 6);
  });

  it("names the dex of a builder deployed coin", () => {
    expect(dexOf("xyz:GOLD")).toBe("xyz");
    expect(dexOf("BTC")).toBe("");
  });
});

describe("open orders", () => {
  const parsed = parseOpenOrders(variants.orders);

  it("keeps resting limit orders with post only and executed size", () => {
    const limit = parsed.filter((o) => o.kind === "limit");
    expect(limit).toHaveLength(4);
    expect(limit.some((o) => o.kind === "limit" && o.postOnly)).toBe(true);
    expect(limit.some((o) => o.kind === "limit" && !o.postOnly)).toBe(true);
  });

  it("classifies stops and take profits, market and limit execution, and whole-position size", () => {
    const triggers = parsed.flatMap((o) => (o.kind === "trigger" ? [o] : []));
    expect(new Set(triggers.map((t) => t.purpose))).toEqual(new Set(["stop", "takeProfit"]));
    expect(triggers.find((t) => t.execution === "limit")?.purpose).toBe("takeProfit");
    expect(triggers.filter((t) => t.size.kind === "all")).toHaveLength(4);
    expect(triggers.filter((t) => t.size.kind === "quantity").every((t) => t.reduceOnly || t.execution === "limit")).toBe(true);
  });

  it("maps B to buy and A to sell", () => {
    expect(new Set(parsed.map((o) => o.side))).toEqual(new Set(["buy", "sell"]));
  });
});

describe("fills", () => {
  const fills = parseFills(userFills);

  it("keeps perp fills only and maps side, fee and liquidity", () => {
    expect(fills).toHaveLength(userFills.length);
    const first = fills[0];
    expect(first).toMatchObject({ symbol: "ETH", side: "sell", price: 2237.4, quantity: 0.2224, fee: 0.214962, liquidity: "taker", market: "perp", closedPnl: -2.224 });
  });

  it("skips spot fills", () => {
    const spot = { ...userFills[0], coin: "@107", tid: 1 };
    expect(parseFills([spot])).toEqual([]);
  });

  it("refuses a fee in a token without a fixed USD value", () => {
    expect(() => parseFills([{ ...userFills[0], feeToken: "HYPE" }])).toThrow(/HYPE/);
  });

  it("reproduces the exchange's realized pnl and fees through the replay reducer", () => {
    const events: LedgerEvent[] = [...fills].reverse().map((fill) => ({ kind: "fill", fill }));
    const funding: LedgerEvent[] = parseFunding(userFunding).map((f) => ({ kind: "funding", funding: { symbol: f.symbol, at: f.at, amount: f.amount } }));
    const book = reduceLedger(sortLedger([...events, ...funding]));
    expect(Math.abs(book.realized - sum(fills.map((f) => f.closedPnl ?? 0)))).toBeLessThan(0.5);
    expect(book.fees).toBeCloseTo(sum(fills.map((f) => f.fee)), 6);
    expect(book.funding).toBeCloseTo(sum(parseFunding(userFunding).map((f) => f.amount)), 6);
    expect(Object.keys(book.lots)).toEqual([]);
  });
});

describe("funding", () => {
  it("reads the signed amount and rate per coin", () => {
    const [first] = parseFunding(userFunding);
    expect(first).toMatchObject({ symbol: "BTC", at: 1779494400000, amount: -0.039263, rate: -0.0000056594 });
    expect(parseFunding(userFunding)).toHaveLength(userFunding.length);
  });
});

describe("candles", () => {
  it("reads open time and OHLCV", () => {
    const parsed = parseCandles(candles);
    expect(parsed[0]).toMatchObject({ start: 1793062800000, open: 80192, high: 80360, low: 79993, close: 80031, volume: 1611.89064 });
    expect(parsed).toHaveLength(candles.length);
  });
});

describe("order history", () => {
  const parsed = parseOrderHistory(historicalOrders);

  it("keeps one record per order id at its latest status", () => {
    const ids = parsed.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(historicalOrders.map((o) => o.order.oid)).size).toBeGreaterThanOrEqual(ids.length);
  });

  it("maps statuses and order kinds", () => {
    expect(new Set(parsed.map((o) => o.status))).toContain("Filled");
    expect(new Set(parsed.map((o) => o.status))).toContain("Cancelled");
    expect(new Set(parsed.map((o) => o.kind)).has("trigger")).toBe(true);
  });
});

describe("market data", () => {
  it("reads mids as numbers", () => {
    expect(parseMids(allMids)["BTC"]).toBeGreaterThan(1000);
  });

  it("lists builder dexs and skips the null default entry", () => {
    expect(parsePerpDexNames(perpDexs)).toContain("xyz");
    expect(parsePerpDexNames(perpDexs)).not.toContain("");
  });

  it("finds the stable quoted spot pair of a base token", () => {
    const pricing = parseSpotPricing(spotMeta);
    expect(pricing.tokenNames.get(0)).toBe("USDC");
    expect(pricing.pairNameByBase.get(1)).toBeDefined();
  });
});
