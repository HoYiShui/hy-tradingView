import { describe, expect, it } from "vitest";
import { DAY_MS, makeClock, realSecondsToFinish, seekTo, stepSpeed, tick, togglePlay, withSpeed } from "./clock";

const clock = makeClock(0, 365 * DAY_MS);

describe("clock", () => {
  it("does not move while paused", () => {
    expect(tick(clock, 1000).t).toBe(0);
  });

  it("advances one day per real second at 1x", () => {
    expect(tick(togglePlay(clock), 1000).t).toBe(DAY_MS);
  });

  it("scales with the speed preset: 365 days at 1.2x takes about five minutes", () => {
    const c = withSpeed(togglePlay(clock), 1.2);
    expect(realSecondsToFinish(c)).toBeCloseTo(304.2, 1);
    expect(tick(c, 1000).t).toBeCloseTo(1.2 * DAY_MS);
  });

  it("stops at the end and restarts from the beginning when played again", () => {
    const end = tick({ ...togglePlay(clock), t: clock.to - 10 }, 1000);
    expect(end).toMatchObject({ t: clock.to, playing: false });
    expect(togglePlay(end)).toMatchObject({ t: 0, playing: true });
  });

  it("clamps seeks into the span and steps speeds without leaving the list", () => {
    expect(seekTo(clock, -5).t).toBe(0);
    expect(seekTo(clock, 1e20).t).toBe(clock.to);
    expect(stepSpeed(clock, -1).speed).toBe(0.5);
    expect(stepSpeed(withSpeed(clock, 20), 1).speed).toBe(20);
  });
});
