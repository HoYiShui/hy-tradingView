import type { AccountInfo } from "@hy/types";
import { symbolLabel } from "../lib/format";
import { createContext, useContext } from "react";
import { INITIAL_FEED_STATE, useFeedStore, type FeedState } from "../store/feedStore";

const AccountContext = createContext<AccountInfo | null>(null);

export const AccountProvider = AccountContext.Provider;

export function useAccount(): AccountInfo {
  const account = useContext(AccountContext);
  if (account === null) throw new Error("useAccount outside AccountProvider");
  return account;
}

export function useSymbolLabel(): (symbol: string) => string {
  const { exchange } = useAccount();
  return (symbol) => symbolLabel(exchange, symbol);
}

export function useFeedState<T>(select: (s: FeedState) => T): T {
  const { id } = useAccount();
  return useFeedStore((s) => select(s.feeds[id] ?? INITIAL_FEED_STATE));
}
