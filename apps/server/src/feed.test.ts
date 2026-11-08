import { describe, expect, it } from "vitest";
import { Millis, type AccountSnapshot, type Feed } from "@hy/types";
import { nextFeed } from "./feed.js";

const snapshot = { exchange: "backpack", asOf: Millis.parse(5) } as AccountSnapshot;
const fail = (at: number, reason = "boom") => ({ ok: false as const, reason, at: Millis.parse(at) });

describe("nextFeed", () => {
  it("goes live on the first success", () => {
    expect(nextFeed({ kind: "connecting" }, { ok: true, snapshot })).toEqual({ kind: "live", snapshot });
  });

  it("is down when the first poll fails and remembers when it started", () => {
    const first = nextFeed({ kind: "connecting" }, fail(10));
    expect(first).toEqual({ kind: "down", since: 10, reason: "boom" });
    expect(nextFeed(first, fail(20, "again"))).toEqual({ kind: "down", since: 10, reason: "again" });
  });

  it("keeps the last snapshot as stale after a failure and keeps the first failure time", () => {
    const stale = nextFeed({ kind: "live", snapshot }, fail(10));
    expect(stale).toEqual({ kind: "stale", snapshot, since: 10, reason: "boom" });
    expect(nextFeed(stale, fail(20, "still"))).toEqual({ kind: "stale", snapshot, since: 10, reason: "still" });
  });

  it("recovers to live from stale and down", () => {
    const stale: Feed = { kind: "stale", snapshot, since: Millis.parse(1), reason: "x" };
    const down: Feed = { kind: "down", since: Millis.parse(1), reason: "x" };
    expect(nextFeed(stale, { ok: true, snapshot }).kind).toBe("live");
    expect(nextFeed(down, { ok: true, snapshot }).kind).toBe("live");
  });
});
