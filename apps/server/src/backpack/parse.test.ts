import { describe, expect, it } from "vitest";
import account from "../../../../scripts/samples/account.json";
import collateral from "../../../../scripts/samples/collateral.json";
import fills from "../../../../scripts/samples/fills.json";
import funding from "../../../../scripts/samples/funding.json";
import klines from "../../../../scripts/samples/klines.json";
import openOrders from "../../../../scripts/samples/open-orders.json";
import positionHistory from "../../../../scripts/samples/position-history.json";
import positions from "../../../../scripts/samples/positions.json";
import { buildSnapshot } from "../domain.js";
import { Millis } from "@hy/types";
import {
  parseAccountParts,
  parseCandles,
  parseFills,
  parseFunding,
  parseOpenOrders,
  parsePositionHistory,
  parsePositions,
} from "./parse.js";

describe("positions", () => {
  it("parses a long position with open PnL as realized plus unrealized", () => {
    const [p] = parsePositions(positions);
    expect(p).toMatchObject({
      symbol: "BTC_USDC_PERP",
      direction: "long",
      quantity: 0.00333,
      entryPrice: 75000,
      liquidationPrice: null,
    });
    expect(p?.openPnl).toBeCloseTo(Number(positions[0]?.pnlRealized) + Number(positions[0]?.pnlUnrealized), 6);
  });

  it("reads a negative net quantity as a short with absolute size", () => {
    const [p] = parsePositions([{ ...positions[0], netQuantity: "-0.5", netExposureNotional: "-37500" }]);
    expect(p).toMatchObject({ direction: "short", quantity: 0.5, notional: 37500 });
  });

  it("drops flat positions and keeps a real liquidation price", () => {
    expect(parsePositions([{ ...positions[0], netQuantity: "0" }])).toEqual([]);
    const [p] = parsePositions([{ ...positions[0], estLiquidationPrice: "60000" }]);
    expect(p?.liquidationPrice).toBe(60000);
  });

  it("rejects a payload with a non-numeric price", () => {
    expect(() => parsePositions([{ ...positions[0], markPrice: "abc" }])).toThrow();
  });
});

describe("open orders", () => {
  const parsed = parseOpenOrders(openOrders);

  it("parses limit orders", () => {
    expect(parsed[0]).toMatchObject({ kind: "limit", side: "buy", price: 74000, quantity: 0.01351, postOnly: true });
  });

  it("parses a stop with no price as a reduce-only market trigger on the whole position", () => {
    expect(parsed.at(-1)).toMatchObject({
      kind: "trigger",
      side: "sell",
      triggerPrice: 73000,
      execution: "market",
      size: { kind: "all" },
      reduceOnly: true,
    });
  });

  it("reads percentage and absolute trigger sizes", () => {
    const stop = openOrders.at(-1);
    const size = (triggerQuantity: string) => {
      const [o] = parseOpenOrders([{ ...stop, triggerQuantity }]);
      return o?.kind === "trigger" ? o.size : null;
    };
    expect(size("50%")).toEqual({ kind: "percent", percent: 50 });
    expect(size("100%")).toEqual({ kind: "all" });
    expect(size("0.2293")).toEqual({ kind: "quantity", quantity: 0.2293 });
  });

  it("rejects a trigger order whose size it cannot read", () => {
    const stop = openOrders.at(-1);
    expect(() => parseOpenOrders([{ ...stop, quantity: null, triggerQuantity: "lots" }])).toThrow(/unsupported quantity/);
  });
});

describe("history", () => {
  it("parses fills with UTC timestamps and maker flag", () => {
    expect(parseFills(fills)[0]).toMatchObject({
      id: "100386785",
      side: "buy",
      price: 75000,
      liquidity: "maker",
      at: Date.parse("2026-11-06T15:04:54.103Z"),
    });
  });

  it("parses funding payments", () => {
    expect(parseFunding(funding)[0]).toMatchObject({ amount: -0.003159, at: Date.parse("2026-11-08T08:00:00Z") });
  });

  it("parses an open position record with a null close time", () => {
    expect(parsePositionHistory(positionHistory)[0]).toMatchObject({ closedAt: null, realizedPnl: 2.809854 });
  });

  it("parses space separated kline times as UTC", () => {
    const [c] = parseCandles(klines);
    expect(c?.start).toBe(Date.parse("2026-11-08T06:00:00Z"));
    expect(c).toMatchObject({ open: 75737.4, high: 75750, low: 75681.3, close: 75726.6 });
  });
});

describe("snapshot from the recorded account", () => {
  it("derives equity, gross notional and leverage", () => {
    const snapshot = buildSnapshot({
      asOf: Millis.parse(1),
      parts: parseAccountParts(account, collateral),
      positions: parsePositions(positions),
      openOrders: parseOpenOrders(openOrders),
    });
    expect(snapshot.account.equity).toBeCloseTo(Number(collateral.netEquity), 6);
    expect(snapshot.account.leverageLimit).toBe(75);
    expect(snapshot.metrics.leverage).toBeCloseTo(Number(positions[0]?.netExposureNotional) / Number(collateral.netEquity), 6);
    expect(snapshot.openOrders).toHaveLength(5);
  });
});
