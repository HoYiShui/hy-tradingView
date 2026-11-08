import { AccountList, API, type AccountInfo, type Surface } from "@hy/types";
import { useCallback, useEffect, useState } from "react";
import { ACCOUNT_PARAM, pickAccount, withAccountParam } from "../lib/accounts";

export type AccountsLoad =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; accounts: AccountInfo[] };

export function useAccountList(): AccountsLoad {
  const [state, setState] = useState<AccountsLoad>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(API.accounts)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return AccountList.parse(await res.json());
      })
      .then((accounts) => {
        if (!cancelled) setState({ kind: "ready", accounts });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function useSelectedAccount(accounts: readonly AccountInfo[], surface: Surface) {
  const [wanted, setWanted] = useState(() => new URLSearchParams(location.search).get(ACCOUNT_PARAM));
  useEffect(() => {
    const onPop = () => setWanted(new URLSearchParams(location.search).get(ACCOUNT_PARAM));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const select = useCallback((id: string) => {
    history.pushState(null, "", withAccountParam(location.search, id));
    setWanted(id);
  }, []);
  return [pickAccount(accounts, surface, wanted), select] as const;
}
