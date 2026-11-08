# hy-tradingView

A public, read-only dashboard for a live Backpack Exchange perp account. It shows positions, open orders, fills on a BTC candlestick chart, daily realized PnL and cross-margin leverage.

## Setup

Requires Node 24 (uses the built-in `node:sqlite`) and pnpm 10.

1. Create `.env` in the repo root with `BACKPACK_API_URL`, `BACKPACK_WS_API_URL`, `BACKPACK_API_KEY` and `BACKPACK_API_SECRET`. Use a read-only API key. The secret is the base64 ED25519 seed.
2. `pnpm install`
3. `pnpm dev` starts the server on :8787 and the web app on :5173.

To run against a second (test) sub-account, add `BACKPACK_TEST_API_KEY` and `BACKPACK_TEST_API_SECRET` to `.env`. `pnpm dev:test` runs the server on :8788 with `data/test.db`, `pnpm probe:test` writes samples to `scripts/samples-test/`, and `pnpm verify:live:test` checks that server. The mapping onto `BACKPACK_API_KEY` and `BACKPACK_API_SECRET` happens in that process only, so `.env` is never edited. Run `pnpm dev:test` and the live `pnpm dev` at different times, since both start a web dev server on :5173.

Other scripts are `pnpm build`, `pnpm typecheck`, `pnpm test` and `pnpm probe`. The probe calls each read endpoint once and writes redacted samples to `scripts/samples/`. The parser tests run against those samples.

For a single process, run `pnpm build` and then `pnpm --filter @hy/server start`. The server serves `apps/web/dist` when it exists.

## Architecture

- `packages/types` holds the zod schemas and inferred types for the exchange-agnostic domain: `AccountSnapshot`, `Position`, `OpenOrder` (limit or trigger), `Fill`, `Candle`, `DailyPnl` and the `Feed` state.
- `apps/server` is Hono on Node. `backpack/client.ts` is GET-only by construction and signs requests with ED25519. `backpack/parse.ts` is the only place raw Backpack payloads are parsed. Everything else trusts the domain types. `exchange.ts` is the small interface a second exchange would implement.
- One poller reads positions, orders and collateral every 2 seconds and keeps the latest snapshot in memory. Browsers receive it over SSE at `/api/stream`. Browser traffic never triggers a Backpack call for the snapshot.
- Fills, funding and position history sync incrementally into SQLite at `data/dashboard.db`. Daily PnL is a SQL aggregation.
- Candles are fetched from the public klines endpoint on demand, stored in SQLite, and refreshed at most once per 2 seconds per interval no matter how many browsers ask. Concurrent requests share one upstream call.
- The poller also records an equity snapshot per 5 minute bucket (restarts overwrite the bucket, so they never duplicate). `/api/equity?range=1d|7d|30d|all` downsamples in SQL to at most about 600 points. The curve is raw account equity. Deposits and withdrawals are not tracked, so use it as performance only for an account without capital flows. There is no backfill before the first snapshot, since that needs a known starting equity.
- The API has a per-IP rate limit and a cap on open streams.
- `apps/web` is Vite, React, Tailwind with shadcn/ui components, Lucide icons and lightweight-charts. One Zustand store holds the latest SSE snapshot and panels subscribe by selector. History and candles use plain fetch.
- `pnpm verify:live` compares the running server with direct signed calls and greps served responses and the bundle for the key.

## Time machine

`/replay` replays the account's past trading like a first-person terminal: a clock with play and pause, speed presets (1x is one day per second, 20x is twenty), a scrub bar, and panels for header tiles, positions, open orders, fills, the BTC candle chart with B/S arrows, and an equity curve, all at clock time.

- `packages/replay` holds the pure reducer. `reduceLedger` folds sorted fills and funding events into a `Book` (per-symbol quantity and average entry, realized PnL, funding, fees). `snapshotAt` marks it to the candles and derives equity, notional and cross leverage. `buildTimeline` and `seek` keep a checkpoint every 512 events, so advancing the clock applies only the new events and a scrub back replays at most 511.
- Equity is back-derived with no capital config: the starting balance is today's real equity minus all later PnL, funding and fees minus open PnL. The curve is therefore only valid for an account without deposits or withdrawals. The `live` account has one deposit before its first fill, so it reconciles. The `test` account has 144 deposits and 53 withdrawals, so its equity curve is distorted even though its positions and PnL are exact.
- `GET /api/replay?interval=` returns everything in compact tuples (fills, funding, candles from the first BTC fill, order spans, the equity anchor). It reads only SQLite and the in-memory snapshot, with no Backpack call. Order history syncs every 60 seconds into an `orders` table.
- Open orders are approximate. Order history keeps only the final state, so a filled order is open from creation to its last fill (exact), and a cancelled one stays open until the next order on the same market and side, capped at 6 hours.
- Marks come from the BTC candles only. Other perp symbols are marked at their last fill price until the last event, then at the live mark. Spot fills are ignored, like the exchange's position fees.
- `pnpm reconcile:replay` compares the reconstruction with the real positions and equity (use `pnpm reconcile:replay:test` for the test account). `pnpm bench:replay` times the reducer over the stored fills.

## Security

The dashboard is public by design. Anyone who can reach the server can see the account. The key is read-only, lives only in the server environment, and is never sent to the browser. Config is validated at startup and error messages name variables without echoing values.
