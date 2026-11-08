import { z } from "zod";
import { Millis, type AccountSnapshot, type Feed } from "@hy/types";
import type { ExchangeReader } from "./exchange.js";

export function describeError(e: unknown): string {
  if (e instanceof z.ZodError) return `unexpected exchange payload: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
  return e instanceof Error ? e.message : String(e);
}

export type PollResult = { ok: true; snapshot: AccountSnapshot } | { ok: false; reason: string; at: Millis };

export function nextFeed(prev: Feed, result: PollResult): Feed {
  if (result.ok) return { kind: "live", snapshot: result.snapshot };
  switch (prev.kind) {
    case "live":
      return { kind: "stale", snapshot: prev.snapshot, since: result.at, reason: result.reason };
    case "stale":
      return { ...prev, reason: result.reason };
    case "connecting":
    case "down":
      return { kind: "down", since: prev.kind === "down" ? prev.since : result.at, reason: result.reason };
    default: {
      const _exhaustive: never = prev;
      return _exhaustive;
    }
  }
}

export function createFeed(reader: ExchangeReader, options: { pollMs: number; log: (msg: string) => void }) {
  let current: Feed = { kind: "connecting" };
  const listeners = new Set<(feed: Feed) => void>();
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  async function poll(): Promise<void> {
    let result: PollResult;
    try {
      result = { ok: true, snapshot: await reader.fetchLive() };
    } catch (e) {
      const reason = describeError(e);
      options.log(`live poll failed: ${reason}`);
      result = { ok: false, reason, at: Millis.parse(Date.now()) };
    }
    current = nextFeed(current, result);
    for (const fn of listeners) fn(current);
    if (!stopped) timer = setTimeout(poll, options.pollMs);
  }

  return {
    current: () => current,
    subscribe(fn: (feed: Feed) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    listenerCount: () => listeners.size,
    start(): void {
      void poll();
    },
    stop(): void {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
