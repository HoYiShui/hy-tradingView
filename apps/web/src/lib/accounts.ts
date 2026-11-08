import type { AccountInfo, Surface } from "@hy/types";

export const ACCOUNT_PARAM = "account";

export function accountsOn(accounts: readonly AccountInfo[], surface: Surface): AccountInfo[] {
  return accounts.filter((a) => a.surfaces.includes(surface));
}

export function pickAccount(accounts: readonly AccountInfo[], surface: Surface, wanted: string | null): AccountInfo | null {
  const onSurface = accountsOn(accounts, surface);
  return onSurface.find((a) => a.id === wanted) ?? onSurface[0] ?? null;
}

export function withAccountParam(search: string, id: string): string {
  const params = new URLSearchParams(search);
  params.set(ACCOUNT_PARAM, id);
  return `?${params}`;
}
