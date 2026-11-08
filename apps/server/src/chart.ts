import type { MarketSymbol } from "@hy/types";
import type { ChartChoice } from "./config.js";
import type { Store } from "./db.js";
import type { ExchangeReader } from "./exchange.js";

export function resolveChartSymbol(input: { choice: ChartChoice; store: Pick<Store, "mostTradedSymbol">; fallback: MarketSymbol }): MarketSymbol {
  switch (input.choice.kind) {
    case "default":
      return input.fallback;
    case "most-traded":
      return input.store.mostTradedSymbol() ?? input.fallback;
    case "market":
      return input.choice.symbol;
    default: {
      const _exhaustive: never = input.choice;
      return _exhaustive;
    }
  }
}

export type ChartGuard = {
  readonly symbol: MarketSymbol;
  check(): Promise<string | null>;
};

export function createChartGuard(input: { reader: Pick<ExchangeReader, "exchange" | "marketExists">; symbol: MarketSymbol; log: (msg: string) => void }): ChartGuard {
  let verdict: string | null | undefined;
  let pending: Promise<string | null> | null = null;

  async function verify(): Promise<string | null> {
    try {
      const exists = await input.reader.marketExists(input.symbol);
      verdict = exists ? null : `Chart market ${input.symbol} does not exist on ${input.reader.exchange}. Fix ACCOUNT_<ID>_CHART.`;
      if (verdict !== null) input.log(verdict);
      return verdict;
    } catch (e) {
      input.log(`could not verify chart market ${input.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      pending = null;
    }
  }

  return {
    symbol: input.symbol,
    check() {
      if (verdict !== undefined) return Promise.resolve(verdict);
      pending ??= verify();
      return pending;
    },
  };
}
