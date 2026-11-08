import { Feed } from "@hy/types";
import { describe, expect, it } from "vitest";
import { INITIAL_FEED_STATE, reduceFeed } from "./feedStore";

const down = Feed.parse({ kind: "down", since: 0, reason: "boom" });

describe("reduceFeed", () => {
  it("keeps the last feed while the transport reconnects", () => {
    const withFeed = reduceFeed(INITIAL_FEED_STATE, { kind: "feed", feed: down });
    const dropped = reduceFeed(withFeed, { kind: "error" });
    expect(dropped).toEqual({ feed: down, transport: "reconnecting" });
  });

  it("marks the transport open again on the next feed event", () => {
    const dropped = reduceFeed(INITIAL_FEED_STATE, { kind: "error" });
    expect(reduceFeed(dropped, { kind: "feed", feed: down }).transport).toBe("open");
  });

  it("returns the same state object when nothing changes", () => {
    const open = reduceFeed(INITIAL_FEED_STATE, { kind: "open" });
    expect(reduceFeed(open, { kind: "open" })).toBe(open);
  });
});
