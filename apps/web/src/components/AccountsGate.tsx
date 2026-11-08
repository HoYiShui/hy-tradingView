import type { AccountInfo } from "@hy/types";
import type { ReactNode } from "react";
import { useAccountList } from "../hooks/useAccounts";

export function Notice({ tone, children }: { tone: "muted" | "error"; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`mx-auto mt-10 max-w-xl rounded border border-dashed border-border px-3 py-10 text-center ${tone === "error" ? "text-loss" : "text-muted-foreground"}`}>
      {children}
    </div>
  );
}

export function AccountsGate({ children }: { children: (accounts: AccountInfo[]) => ReactNode }) {
  const load = useAccountList();
  if (load.kind === "loading") return <Notice tone="muted">Loading accounts</Notice>;
  if (load.kind === "error") return <Notice tone="error">Could not load accounts ({load.message})</Notice>;
  return <>{children(load.accounts)}</>;
}
