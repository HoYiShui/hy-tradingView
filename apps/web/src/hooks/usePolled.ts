import { useEffect, useState } from "react";

export interface Polled<T> {
  data: T;
  error: string | null;
  loaded: boolean;
}

export function usePolled<T>(url: string, everyMs: number, initial: T): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ data: initial, error: null, loaded: false });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = (await res.json()) as T;
        if (!cancelled) setState({ data, error: null, loaded: true });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loaded: true }));
      }
    };
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, everyMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, everyMs]);

  return state;
}
