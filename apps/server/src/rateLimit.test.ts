import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

describe("rate limiter", () => {
  it("allows up to the limit per client per minute, then resets", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 2, now: () => t });
    expect([limiter.allow("a"), limiter.allow("a"), limiter.allow("a")]).toEqual([true, true, false]);
    expect(limiter.allow("b")).toBe(true);
    t = 60_000;
    expect(limiter.allow("a")).toBe(true);
  });
});
