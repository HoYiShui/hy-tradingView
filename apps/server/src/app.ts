import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";
import { ACCOUNT_LEAVES, API, CandleInterval, EquityRange, MarketSymbol, Millis, type Feed, type Surface } from "@hy/types";
import { resolveAccount, type Registry, type ServedAccount } from "./accounts.js";
import { buildReplayPayload } from "./replay.js";
import { createRateLimiter } from "./rateLimit.js";

const MAX_STREAM_CLIENTS = 200;

const CandleQuery = z.object({
  interval: CandleInterval,
  since: z.coerce.number().int().nonnegative().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
const EquityQuery = z.object({ range: EquityRange.default("7d") });
const ReplayQuery = z.object({ interval: CandleInterval.default("1h"), account: z.string().optional() });
const FillQuery = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(200),
  symbol: MarketSymbol.optional(),
});

export function createApp(deps: { registry: Registry; webRoot: string | null }) {
  const app = new Hono();
  const limiter = createRateLimiter({ perMinute: 240 });

  app.use("/api/*", async (c, next) => {
    const ip = getConnInfo(c).remote.address ?? "unknown";
    if (!limiter.allow(ip)) return c.json({ error: "rate limited" }, 429);
    await next();
  });

  const dashboard = (leaf: keyof typeof ACCOUNT_LEAVES, handler: (c: Context, account: ServedAccount) => Response | Promise<Response>) =>
    app.get(`/api/accounts/:id/${ACCOUNT_LEAVES[leaf]}`, (c) => {
      const account = resolveAccount(deps.registry, "dashboard", c.req.param("id"));
      return account === null ? c.json({ error: "unknown account" }, 404) : handler(c, account);
    });

  app.get(API.accounts, (c) => c.json(deps.registry.map((a) => a.info)));

  dashboard("snapshot", (c, a) => c.json(a.feed.current()));

  dashboard("stream", (c, a) => {
    if (a.feed.listenerCount() >= MAX_STREAM_CLIENTS) return c.json({ error: "too many streams" }, 503);
    return streamSSE(c, async (stream) => {
      const send = (feed: Feed) => stream.writeSSE({ event: "feed", data: JSON.stringify(feed) });
      await send(a.feed.current());
      const unsubscribe = a.feed.subscribe((feed) => void send(feed));
      const aborted = new Promise<void>((resolve) => stream.onAbort(resolve));
      const heartbeat = setInterval(() => void stream.write(": ping\n\n"), 15_000);
      await aborted;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  dashboard("candles", async (c, a) => {
    const q = CandleQuery.safeParse(c.req.query());
    if (!q.success || !a.info.intervals.includes(q.data.interval)) return c.json({ error: "bad query" }, 400);
    const since = q.data.since === undefined ? null : Millis.parse(q.data.since);
    const before = q.data.before === undefined ? null : Millis.parse(q.data.before);
    return c.json(await a.candles.get(q.data.interval, { since, before, limit: q.data.limit }));
  });

  dashboard("fills", (c, a) => {
    const q = FillQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "bad query" }, 400);
    return c.json(a.store.fills(q.data.limit, q.data.symbol ?? null));
  });

  dashboard("equity", (c, a) => {
    const q = EquityQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "bad query" }, 400);
    return c.json(a.store.equity(q.data.range, Date.now()));
  });

  dashboard("dailyPnl", (c, a) => c.json(a.store.dailyPnl()));

  app.get(API.replay, async (c) => {
    const q = ReplayQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: "bad query" }, 400);
    const account = resolveAccount(deps.registry, "replay", q.data.account);
    if (account === null) return c.json({ error: "unknown account" }, 404);
    if (!account.info.intervals.includes(q.data.interval)) return c.json({ error: "bad query" }, 400);
    const feed = account.feed.current();
    if (feed.kind !== "live" && feed.kind !== "stale") return c.json({ error: "no snapshot yet" }, 503);
    await account.candles.refresh(q.data.interval);
    return c.json(buildReplayPayload({ store: account.store, snapshot: feed.snapshot, interval: q.data.interval, symbol: account.info.chartSymbol }));
  });

  if (deps.webRoot !== null) {
    app.use("/*", serveStatic({ root: deps.webRoot }));
    app.get("*", serveStatic({ path: "index.html", root: deps.webRoot }));
  }

  return app;
}
