import { API, ReplayPayload, type CandleInterval } from "@hy/types";
import { useEffect, useState } from "react";
import { buildModel, type ReplayModel } from "../lib/replayModel";

export type ReplayLoad =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; model: ReplayModel; loadMs: number };

export function useReplayData(interval: CandleInterval): ReplayLoad {
  const [state, setState] = useState<ReplayLoad>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    const started = performance.now();
    fetch(`${API.replay}?interval=${interval}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return ReplayPayload.parse(await res.json());
      })
      .then((payload) => {
        if (!cancelled) setState({ kind: "ready", model: buildModel(payload), loadMs: performance.now() - started });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [interval]);
  return state;
}
