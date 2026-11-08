import { describe, expect, it } from "vitest";
import { mergeRanges, planFetches, uncovered } from "./coverage.js";

describe("uncovered", () => {
  it("returns the whole range when nothing is covered", () => {
    expect(uncovered({ from: 0, to: 100 }, [])).toEqual([{ from: 0, to: 100 }]);
  });

  it("returns only the gaps around and between covered ranges", () => {
    expect(uncovered({ from: 0, to: 100 }, [{ from: 20, to: 40 }, { from: 60, to: 80 }])).toEqual([
      { from: 0, to: 20 },
      { from: 40, to: 60 },
      { from: 80, to: 100 },
    ]);
  });

  it("ignores coverage outside the wanted range and returns nothing when fully covered", () => {
    expect(uncovered({ from: 10, to: 50 }, [{ from: 0, to: 200 }])).toEqual([]);
    expect(uncovered({ from: 10, to: 50 }, [{ from: 60, to: 70 }])).toEqual([{ from: 10, to: 50 }]);
  });

  it("handles unsorted and overlapping coverage", () => {
    expect(uncovered({ from: 0, to: 100 }, [{ from: 50, to: 90 }, { from: 0, to: 60 }])).toEqual([{ from: 90, to: 100 }]);
  });
});

describe("planFetches", () => {
  it("splits gaps into bounded chunks and orders them newest first", () => {
    const plan = planFetches({ from: 0, to: 250 }, [], 100);
    expect(plan).toEqual([{ from: 200, to: 250 }, { from: 100, to: 200 }, { from: 0, to: 100 }]);
  });

  it("only plans the missing older part once newer data is covered, so reruns fetch nothing new", () => {
    const covered = [{ from: 100, to: 250 }];
    expect(planFetches({ from: 0, to: 250 }, covered, 100)).toEqual([{ from: 0, to: 100 }]);
    expect(planFetches({ from: 0, to: 250 }, mergeRanges([...covered, { from: 0, to: 100 }]), 100)).toEqual([]);
  });
});

describe("mergeRanges", () => {
  it("joins touching ranges", () => {
    expect(mergeRanges([{ from: 0, to: 10 }, { from: 10, to: 20 }, { from: 30, to: 40 }])).toEqual([
      { from: 0, to: 20 },
      { from: 30, to: 40 },
    ]);
  });
});
