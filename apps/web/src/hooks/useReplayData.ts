import { API, ReplayPayload, type CandleInterval } from "@hy/types";
import { useEffect, useState } from "react";
import { buildModel, type ReplayModel } from "../lib/replayModel";

export type ReplayLoad =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; model: ReplayModel; loadMs: number };

async function failureMessage(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") return body.error;
  return `${res.status} ${res.statusText}`;
}

export function useReplayData(accountId: string, interval: CandleInterval): ReplayLoad {
  const [state, setState] = useState<ReplayLoad>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    const started = performance.now();
    fetch(`${API.replay}?account=${encodeURIComponent(accountId)}&interval=${interval}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await failureMessage(res));
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
  }, [accountId, interval]);
  return state;
}
