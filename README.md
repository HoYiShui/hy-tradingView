# hy-tradingView

A public, read-only dashboard for Backpack and Hyperliquid perp accounts. It shows positions, open orders, fills on a BTC candlestick chart, daily realized PnL and cross-margin leverage.

## Setup

Requires Node 24 (uses the built-in `node:sqlite`) and pnpm 10.

1. Copy `.env.example` to `.env` and fill it in. `ACCOUNTS` lists account ids. Each id needs `ACCOUNT_<ID>_EXCHANGE`, `_LABEL`, `_SURFACES` and that exchange's credentials. For `backpack` use read-only API keys. The secret is the base64 ED25519 seed. For `hyperliquid` set only `ACCOUNT_<ID>_ADDRESS`, the public wallet address (EIP-55 checksum or all one case). Hyperliquid reads need no key. A private key variable is rejected by name and must never be set.
2. `pnpm install`
3. `pnpm dev` starts the server on :8787 and the web app on :5173.

An account's surfaces say where it appears. `dashboard` puts it on `/` (with a switcher when more than one account has it, and `?account=<id>` in the URL). `replay` puts it on `/replay`. One account can have both. Each account gets its own database at `data/<id>.db`, so no state is shared. The server refuses to start on a missing or invalid variable and names it without echoing any value.

Scripts that talk to an account take its id. `pnpm probe <id>` writes redacted samples to `scripts/samples-<id>/` for Backpack and to `scripts/samples-hyperliquid/` for Hyperliquid. `pnpm verify <id>` checks the running server against direct exchange calls (`scripts/direct/`) for each surface of that account. `pnpm reconcile:replay <id>` and `pnpm bench:replay <id>` read that account's database.

Other scripts are `pnpm build`, `pnpm typecheck` and `pnpm test`. The probe calls each read endpoint once. The parser tests run against the samples in `scripts/samples/`, `scripts/samples-test/` and `scripts/samples-hyperliquid/`.

For a single process, run `pnpm build` and then `pnpm --filter @hy/server start`. The server serves `apps/web/dist` when it exists.

## Architecture

- `packages/types` holds the zod schemas and inferred types for the exchange-agnostic domain: `AccountSnapshot`, `Position`, `OpenOrder` (limit or trigger), `Fill`, `Candle`, `DailyPnl` and the `Feed` state.
- `apps/server` is Hono on Node. `backpack/client.ts` is GET-only by construction and signs requests with ED25519. `backpack/parse.ts` is the only place raw Backpack payloads are parsed. Everything else trusts the domain types. `hyperliquid/` is the second adapter: `client.ts` posts to the open `/info` endpoint only, with retries and backoff because the network resets connections, `raw.ts` and `parse.ts` hold the zod schemas derived from real responses, and `snapshot.ts` is the pure equity and margin math. `exchange.ts` is the interface an adapter implements. It owns the snapshot, fills, funding, orders, candles, the default chart market (`defaultChartSymbol`, overridable per account) and its `capabilities`: the candle intervals it serves, its history limits and the slowest polling it tolerates. Symbol naming, quote currency and interval names live inside each adapter. `exchanges.ts` picks the adapter from the account's credentials, which `config.ts` parses as a union keyed by exchange.
- `accounts.ts` builds one `AccountContext` per configured account (adapter, store, feed, candle service) and a registry the routes look accounts up in. A surface decides which pollers run, and the adapter's capabilities set a floor under their pace. A dashboard account polls every 2 seconds, records equity and syncs fills, funding and position history. A replay-only account polls every 30 seconds for its equity anchor and syncs fills, funding and order history. Browser traffic never reaches an adapter except through the candle service. An unknown id or an account without the surface gets a 404.
- Each account's poller reads positions, orders and collateral and keeps the latest snapshot in memory. Browsers receive a dashboard account's snapshot over SSE at `/api/accounts/:id/stream`, or once at `/api/accounts/:id/snapshot`. Browser traffic never triggers a Backpack call for the snapshot. `/api/accounts` lists accounts with their label, exchange, surfaces, chart market, candle intervals and history limits. The web interval tabs come from that list, and a candle request for an interval the account does not serve gets a 400.
- Fills, funding and position history sync incrementally into the account's SQLite file. Daily PnL is a SQL aggregation.
- Candles are fetched from the exchange's public candle endpoint on demand, stored in SQLite, and refreshed at most once per 2 seconds per interval no matter how many browsers ask. Concurrent requests share one upstream call.
- The poller also records an equity snapshot per 5 minute bucket (restarts overwrite the bucket, so they never duplicate). `/api/accounts/:id/equity?range=1d|7d|30d|all` downsamples in SQL to at most about 600 points. The curve is raw account equity. Deposits and withdrawals are not tracked, so use it as performance only for an account without capital flows. There is no backfill before the first snapshot, since that needs a known starting equity.
- The API has a per-IP rate limit and a cap on open streams.
- `apps/web` is Vite, React, Tailwind with shadcn/ui components, Lucide icons and lightweight-charts. One Zustand store holds the latest SSE snapshot per account id and panels subscribe by selector for the selected account. History and candles use plain fetch.
- `pnpm verify <id>` compares the running server with direct signed calls and greps served responses and the bundle for every configured key and secret.

## Hyperliquid

Set `ACCOUNT_<ID>_EXCHANGE=hyperliquid` and `ACCOUNT_<ID>_ADDRESS=0x...`. The default chart market is `BTC`. The adapter reads perps only.

- Equity. A unified or portfolio-margin account holds one spot pool whose total already floats with perp unrealized PnL, so equity is the spot USD sum and the perp account value is not added. A standard account sums the perp account value over every dex and adds spot. The mode comes from `userAbstraction`. This was checked against the account's own `portfolio` all-time equity, which equals the spot total.
- HIP-3 dexs. Builder dexs (such as `xyz`) need their own `clearinghouseState` and `frontendOpenOrders` calls and their coins are prefixed (`xyz:GOLD`). The adapter scans the dex list every 10 minutes, then reads only the dexs where the account has positions or orders or has traded.
- Mapping. `B` is buy and `A` is sell. A fill is a taker when `crossed`. Fees must be in a stable token, or the parse fails loudly. Positions carry entry price, liquidation price, leverage and cross or isolated margin. Orders are limit (post-only when `Alo`) or trigger, marked stop or take profit and market or limit. A position-level TP or SL has no size and shows as all. The exchange does not report a break-even price, so it is null.
- History limits. The exchange serves the 5000 most recent candles per interval and the 10000 most recent fills. These are adapter capabilities. The chart and `/replay` print them, the candle backfill never reaches past them, marks the covered range, and never refetches it. Fills sync incrementally and are stored, so the local history can outgrow the exchange window. Order history has a 2000 order window.
- Rate limits. Info requests are weighted. Live polling is no faster than every 15 seconds and syncs no faster than every 15 seconds.
- Fill order. Inside one millisecond the API order is the true order. Ordering by `tid` breaks the replay, so the store keeps insertion order.
- Perp fills carry the exchange's `closedPnl`. The replay reducer's realized PnL is within entry rounding of it.
- Transfers. `userNonFundingLedgerUpdates` is paged by time, 500 rows per page. Deposits, withdrawals, sends, spot transfers, sub-account transfers, vault flows and stable rewards cross the account boundary and count. A send out is the exchange-reported `usdcValue` plus its fee. Account class transfers, staking transfers, liquidations and sends to oneself are internal and ignored. An unknown delta type is stored as excluded (`unclassified`), never dropped.

## Time machine

`/replay` replays the account's past trading like a first-person terminal: a clock with play and pause, speed presets (1x is one day per second, 20x is twenty), a scrub bar, and panels for header tiles, positions, open orders, fills, the BTC candle chart with B/S arrows, and an equity curve, all at clock time.

- `packages/replay` holds the pure reducer. `reduceLedger` folds sorted fills and funding events into a `Book` (per-symbol quantity and average entry, realized PnL, funding, fees). `snapshotAt` marks it to the candles and derives equity, notional and cross leverage. `buildTimeline` and `seek` keep a checkpoint every 512 events, so advancing the clock applies only the new events and a scrub back replays at most 511.
- Equity is back-derived: the starting balance is today's real equity minus all later PnL, funding and fees, minus net transfers, minus open PnL. Transfers are ledger events with a signed USD amount. They shift cash and equity and are never PnL. The amount includes any transfer fee, so a withdrawal is `-(quantity + fee)`. Anything that crosses the account boundary counts, including Backpack internal and sub-account moves. Stablecoins (USDC, USDT, and Hyperliquid's stable tokens) count at par. Hyperliquid sends use the exchange-reported USD value. A Backpack transfer of any other asset has no exchange USD value, so it is excluded as `unpriced`. A transfer that is not confirmed is excluded as `unsettled` and converts once it settles. The header shows the count of excluded transfers as a warning. Nothing is dropped silently. Cancelled, declined, expired, failed and refunded transfers moved no funds and are omitted.
- Transfers sync per account into a `transfers` table, upserted by id, so reruns are idempotent. Each sync restarts from the latest stored time minus a 3 day recheck window, with bounded paging and the same retry discipline as fills. Backpack reads `/wapi/v1/capital/deposits` and `/wapi/v1/capital/withdrawals`. The header shows net deposited capital, and arrows on the equity curve mark each deposit and withdrawal.
- The dashboard `equity_snapshots` curve stays raw account equity. Transfers are tracked for the replay only, so the dashboard curve is performance only for an account without capital flows.
- Residual. `pnpm reconcile:replay <id>` prints the start balance with and without transfers. A perp-only account reconciles to zero (hl: -298.49 before, 0.00 after). An account with spot trading keeps a residual, because the reducer ignores spot fills and excluded transfers carry no value.
- Chart coin. `ACCOUNT_<ID>_CHART` is optional. Set it to a market in the exchange's own naming (`SOL_USDC_PERP`, `SOL`) or to `most-traded`. `most-traded` is the perp coin with the most stored fills, recomputed at startup from the account database, and falls back to the adapter default when there are no fills. The resolved symbol drives the candles, the fill markers and the replay chart, and is served as `chartSymbol` in `/api/accounts`. The server checks that the market exists on the exchange. An unknown market fails only that account's chart, with a 404 and a clear message, and the rest of the account keeps working.
- `GET /api/replay?account=<id>&interval=` (the first replay account when `account` is omitted) returns everything in compact tuples (fills, funding, candles from the first fill on the chart market, order spans, the equity anchor). It reads only SQLite and the in-memory snapshot, with no exchange call. Order history syncs every 60 seconds into an `orders` table.
- Open orders are approximate. Order history keeps only the final state, so a filled order is open from creation to its last fill (exact), and a cancelled one stays open until the next order on the same market and side, capped at 6 hours.
- Marks come from the chart market candles only. Other perp symbols are marked at their last fill price until the last event, then at the live mark. Spot fills are ignored, like the exchange's position fees. Hyperliquid spot fills are not stored.
- `pnpm reconcile:replay <id>` compares the reconstruction with the real positions and equity. `pnpm bench:replay` times the reducer over the stored fills.

## Credits

Charts are drawn by [TradingView Lightweight Charts](https://www.tradingview.com/) (Apache-2.0). The chart's built-in logo is disabled, so the attribution notice lives in `NOTICE` and each page links to tradingview.com in its footer, as the library licence requires.

## Security

The dashboard is public by design. Anyone who can reach the server can see the account. The keys are read-only, live only in the server environment, and are never sent to the browser. Config is validated at startup and error messages name variables without echoing values.
