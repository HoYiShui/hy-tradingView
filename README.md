# hy-tradingView

A public, read-only dashboard for a live Backpack Exchange perp account. It shows positions, open orders, fills on a BTC candlestick chart, daily realized PnL and cross-margin leverage.

## Setup

Requires Node 24 (uses the built-in `node:sqlite`) and pnpm 10.

1. Create `.env` in the repo root with `BACKPACK_API_URL`, `BACKPACK_WS_API_URL`, `BACKPACK_API_KEY` and `BACKPACK_API_SECRET`. Use a read-only API key. The secret is the base64 ED25519 seed.
2. `pnpm install`
3. `pnpm dev` starts the server on :8787 and the web app on :5173.

Other scripts are `pnpm build`, `pnpm typecheck`, `pnpm test` and `pnpm probe`. The probe calls each read endpoint once and writes redacted samples to `scripts/samples/`. The parser tests run against those samples.

For a single process, run `pnpm build` and then `pnpm --filter @hy/server start`. The server serves `apps/web/dist` when it exists.

## Architecture

- `packages/types` holds the zod schemas and inferred types for the exchange-agnostic domain: `AccountSnapshot`, `Position`, `OpenOrder` (limit or trigger), `Fill`, `Candle`, `DailyPnl` and the `Feed` state.
- `apps/server` is Hono on Node. `backpack/client.ts` is GET-only by construction and signs requests with ED25519. `backpack/parse.ts` is the only place raw Backpack payloads are parsed. Everything else trusts the domain types. `exchange.ts` is the small interface a second exchange would implement.
- One poller reads positions, orders and collateral every 2 seconds and keeps the latest snapshot in memory. Browsers receive it over SSE at `/api/stream`. Browser traffic never triggers a Backpack call for the snapshot.
- Fills, funding and position history sync incrementally into SQLite at `data/dashboard.db`. Daily PnL is a SQL aggregation.
- Candles are fetched from the public klines endpoint on demand, stored in SQLite, and refreshed at most once per 2 seconds per interval no matter how many browsers ask. Concurrent requests share one upstream call.
- The API has a per-IP rate limit and a cap on open streams.
- `apps/web` is Vite, React, Tailwind with shadcn/ui components, Lucide icons and lightweight-charts. One Zustand store holds the latest SSE snapshot and panels subscribe by selector. History and candles use plain fetch.
- `pnpm verify:live` compares the running server with direct signed calls and greps served responses and the bundle for the key.

## Security

The dashboard is public by design. Anyone who can reach the server can see the account. The key is read-only, lives only in the server environment, and is never sent to the browser. Config is validated at startup and error messages name variables without echoing values.
