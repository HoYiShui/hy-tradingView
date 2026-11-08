import { describe, expect, it } from "vitest";
import { statusOf } from "./status";

describe("statusOf", () => {
  it("prefers a broken transport over the last feed", () => {
    expect(statusOf({ kind: "connecting" }, "reconnecting").label).toBe("Disconnected");
  });
  it("carries the reason for down feeds", () => {
    const s = statusOf({ kind: "down", since: 0 as never, reason: "upstream 502" }, "open");
    expect(s).toEqual({ tone: "bad", label: "Down", detail: "upstream 502" });
  });
  it("reports connecting", () => {
    expect(statusOf({ kind: "connecting" }, "connecting").tone).toBe("pending");
  });
});
