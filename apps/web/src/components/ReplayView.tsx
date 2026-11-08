import { type AccountInfo, type CandleInterval, type Fill } from "@hy/types";
import { START } from "@hy/replay";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountProvider } from "../hooks/useAccount";
import { useSelectedAccount } from "../hooks/useAccounts";
import { useReplayData } from "../hooks/useReplayData";
import { accountsOn } from "../lib/accounts";
import { firstInterval, historyLimit } from "../lib/history";
import { DAY_MS, SPEEDS, makeClock, realSecondsToFinish, seekTo, tick, togglePlay, withSpeed, type Clock } from "../lib/clock";
import { leverageX, signedUsd, signOf, SIGN_MARK, usd } from "../lib/format";
import { frameAt, type Frame, type ReplayModel } from "../lib/replayModel";
import { SIGN_TEXT, cn } from "../lib/utils";
import { AccountSwitcher } from "./AccountSwitcher";
import { Notice } from "./AccountsGate";
import { FillsTable } from "./FillsTable";
import { PositionsPanel } from "./PositionsTable";
import { ReplayChart } from "./ReplayChart";
import { ReplayEquity } from "./ReplayEquity";
import { Attribution } from "./Attribution";
import { ReplayOrders } from "./ReplayOrders";
import { Tile } from "./StatTiles";
import { TooltipProvider } from "./ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

const FEED_ROWS = 60;
const REPLAY_INTERVALS: readonly CandleInterval[] = ["15m", "1h", "4h", "1d"];

function useClock(model: ReplayModel) {
  const [clock, setClock] = useState<Clock>(() => makeClock(model.start, model.end));
  const playing = clock.playing;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      setClock((c) => tick(c, dt));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return [clock, setClock] as const;
}

function Player({ model }: { model: ReplayModel }) {
  const [clock, setClock] = useClock(model);
  const cursor = useRef(START);
  const frame: Frame = useMemo(() => {
    const f = frameAt(model, cursor.current, clock.t);
    cursor.current = f.cursor;
    return f;
  }, [model, clock.t]);

  const { state } = frame;
  const feed = useMemo<Fill[]>(() => {
    const out: Fill[] = [];
    for (let i = frame.fillCount - 1; i >= 0 && out.length < FEED_ROWS; i--) {
      const f = model.fills[i];
      if (f !== undefined) out.push(f);
    }
    return out;
  }, [model, frame.fillCount]);

  const net = state.totals.realized + state.totals.funding - state.totals.fees;
  const open = signOf(state.metrics.openPnl);
  const netSign = signOf(net);
  const date = new Date(clock.t).toISOString().slice(0, 19).replace("T", " ");

  return (
    <>
      <section aria-label="Replay controls" className="mb-2 flex flex-wrap items-center gap-3 rounded border border-border bg-card px-3 py-2">
        <button
          type="button"
          aria-label={clock.playing ? "Pause" : "Play"}
          onClick={() => setClock((c) => togglePlay(c))}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded bg-primary text-white hover:opacity-90"
        >
          {clock.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <div data-testid="clock" className="num text-base font-semibold text-foreground">{date} UTC</div>
        <Tabs value={String(clock.speed)} onValueChange={(v) => setClock((c) => withSpeed(c, SPEEDS.find((s) => String(s.factor) === v)?.factor ?? 1))}>
          <TabsList aria-label="Replay speed">
            {SPEEDS.map((s) => <TabsTrigger key={s.label} value={String(s.factor)}>{s.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <span className="num text-xs text-muted-foreground">
          1x = 1 day per second. {Math.round(realSecondsToFinish(clock))}s to the end at this speed.
        </span>
        <input
          type="range"
          aria-label="Scrub"
          className="min-w-[240px] flex-1 accent-[var(--primary)]"
          min={model.start}
          max={model.end}
          step={1}
          value={clock.t}
          onChange={(e) => setClock((c) => seekTo({ ...c, playing: false }, Number(e.target.value)))}
        />
        <span className="num text-xs text-muted-foreground">{((clock.t - model.start) / DAY_MS).toFixed(1)} / {((model.end - model.start) / DAY_MS).toFixed(0)} days</span>
      </section>

      <section aria-label="Account at clock" className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-9">
        <Tile label="Equity" value={usd(state.equity)} />
        <Tile label="Net PnL to date" value={`${SIGN_MARK[netSign]} ${signedUsd(net)}`} tone={cn(SIGN_TEXT[netSign])} sub="realized + funding - fees" />
        <Tile label="Net deposited" value={signedUsd(state.totals.transfers)} sub="deposits - withdrawals" />
        <Tile label="Open PnL" value={`${SIGN_MARK[open]} ${signedUsd(state.metrics.openPnl)}`} tone={cn(SIGN_TEXT[open])} />
        <Tile label="Cross leverage" value={leverageX(state.metrics.leverage)} sub={`gross ${usd(state.metrics.grossNotional)}`} />
        <Tile label="Net notional" value={signedUsd(state.metrics.netNotional)} />
        <Tile label="Realized" value={signedUsd(state.totals.realized)} />
        <Tile label="Funding" value={signedUsd(state.totals.funding)} />
        <Tile label="Fees" value={usd(state.totals.fees)} sub={`${frame.fillCount.toLocaleString()} fills`} />
      </section>

      <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-2 lg:col-span-6">
          <ReplayChart model={model} frame={frame} />
          <ReplayEquity model={model} frame={frame} />
        </div>
        <div className="flex min-w-0 flex-col gap-2 lg:col-span-6">
          <PositionsPanel positions={state.positions} emptyText="Flat at this time" />
          <ReplayOrders orders={frame.openOrders} />
          <FillsTable fills={feed} loaded error={null} />
        </div>
      </div>
    </>
  );
}

function ReplayPage({ account, accounts, onSelect }: { account: AccountInfo; accounts: AccountInfo[]; onSelect: (id: string) => void }) {
  const replayIntervals = account.intervals.filter((i) => REPLAY_INTERVALS.includes(i));
  const [interval, setInterval] = useState<CandleInterval>(() => firstInterval(["1h"], replayIntervals) ?? "1h");
  const limit = historyLimit(account.history);
  const load = useReplayData(account.id, interval);
  return (
    <AccountProvider value={account}>
    <TooltipProvider delayDuration={150}>
      <div className="mx-auto max-w-[1680px] px-2 pb-8 pt-2 sm:px-4 sm:pt-3">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-base font-semibold text-foreground">
            Time machine <span className="font-normal text-muted-foreground">{account.label}, replay of past trading reconstructed from fills, funding and fees</span>
          </h1>
          <div className="flex items-center gap-3 text-xs">
            <AccountSwitcher accounts={accountsOn(accounts, "replay")} selected={account.id} onSelect={onSelect} />
            <Tabs value={interval} onValueChange={(v) => setInterval(v as CandleInterval)}>
              <TabsList aria-label="Candle interval">
                {replayIntervals.map((i) => <TabsTrigger key={i} value={i}>{i}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            <a href="/" className="text-primary hover:underline">Dashboard</a>
          </div>
        </header>
        <p className="mb-2 text-xs text-muted-foreground">
          Equity is back-derived from today's equity minus later PnL, funding, fees and net deposits. It assumes no spot trading, and marks open positions to candle opens.
          {load.kind === "ready" && load.model.excludedTransfers > 0 && (
            <span data-testid="excluded-transfers"> {load.model.excludedTransfers} transfers of assets with no USD value are not in the curve.</span>
          )}
          {limit !== null && <span data-testid="history-limit"> {limit}</span>}
        </p>
        {load.kind === "loading" && <div className="rounded border border-dashed border-border px-3 py-10 text-center text-muted-foreground">Loading history</div>}
        {load.kind === "error" && <div role="alert" className="rounded border border-dashed border-border px-3 py-10 text-center text-loss">Could not load replay ({load.message})</div>}
        {load.kind === "ready" && <Player key={load.model.interval} model={load.model} />}
        <Attribution />
      </div>
    </TooltipProvider>
    </AccountProvider>
  );
}

export function ReplayView({ accounts }: { accounts: AccountInfo[] }) {
  const [account, select] = useSelectedAccount(accounts, "replay");
  if (account === null) {
    return (
      <Notice tone="error">
        No account is set up for the time machine. Give an account the replay surface in .env, then restart the server.
        <a href="/" className="mt-3 block text-primary hover:underline">Dashboard</a>
      </Notice>
    );
  }
  return <ReplayPage key={account.id} account={account} accounts={accounts} onSelect={select} />;
}
