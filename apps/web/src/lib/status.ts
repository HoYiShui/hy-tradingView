import type { Feed } from "@hy/types";

export type Transport = "connecting" | "open" | "reconnecting";
export type StatusTone = "ok" | "warn" | "bad" | "pending";

export interface Status {
  tone: StatusTone;
  label: string;
  detail: string | null;
}

export function statusOf(feed: Feed, transport: Transport): Status {
  if (transport === "reconnecting") {
    return { tone: "bad", label: "Disconnected", detail: "Reconnecting to server" };
  }
  switch (feed.kind) {
    case "connecting":
      return { tone: "pending", label: "Connecting", detail: null };
    case "live":
      return { tone: "ok", label: "Live", detail: null };
    case "stale":
      return { tone: "warn", label: "Stale", detail: feed.reason };
    case "down":
      return { tone: "bad", label: "Down", detail: feed.reason };
    default: {
      const _exhaustive: never = feed;
      return _exhaustive;
    }
  }
}

export function snapshotOf(feed: Feed) {
  return feed.kind === "live" || feed.kind === "stale" ? feed.snapshot : null;
}
