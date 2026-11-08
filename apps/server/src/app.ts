import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { API, CandleInterval, Millis, type Feed } from "@hy/types";
import type { Store } from "./db.js";
import type { createCandleService } from "./history.js";
import type { createFeed } from "./feed.js";
import { createRateLimiter } from "./rateLimit.js";

const MAX_STREAM_CLIENTS = 200;

const CandleQuery = z.object({
  interval: CandleInterval,
  since: z.coerce.number().int().nonnegative().optional(),
});
const FillQuery = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200) });

export function createApp(deps: {
  feed: ReturnType<typeof createFeed>;
  candles: ReturnType<typeof createCandleService>;
  store: Store;
  webRoot: string | null;
}) {
  const app = new Hono();
  const limiter = createRateLimiter({ perMinute: 240 });

  app.use("/api/*", async (c, next) => {
    const ip = getConnInfo(c).remote.address ?? "unknown";
    if (!limiter.allow(ip)) return c.json({ error: "rate limited" }, 429);
    await next();
  });

  app.get(API.feedOnce, (c) => c.json(deps.feed.current()));

  app.get(API.feed, (c) => {
    if (deps.feed.listenerCount() >= MAX_STREAM_CLIENTS) return c.json({ error: "too many streams" }, 503);
    return streamSSE(c, async (stream) => {
      const send = (feed: Feed) => stream.writeSSE({ event: "feed", data: JSON.stringify(feed) });
      await send(deps.feed.current());
      const unsubscribe = deps.feed.subscribe((feed) => void send(feed));
      const aborted = new Promise<void>((resolve) => stream.onAbort(resolve));
      const heartbeat = setInterval(() => void stream.write(": ping\n\n"), 15_000);
      await aborted;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get(API.candles, async (c) => {
    const q = CandleQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "bad query" }, 400);
    const since = q.data.since === undefined ? null : Millis.parse(q.data.since);
    return c.json(await deps.candles.get(q.data.interval, since));
  });

  app.get(API.fills, (c) => {
    const q = FillQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "bad query" }, 400);
    return c.json(deps.store.fills(q.data.limit));
  });

  app.get(API.dailyPnl, (c) => c.json(deps.store.dailyPnl()));

  if (deps.webRoot !== null) {
    app.use("/*", serveStatic({ root: deps.webRoot }));
    app.get("*", serveStatic({ path: "index.html", root: deps.webRoot }));
  }

  return app;
}
