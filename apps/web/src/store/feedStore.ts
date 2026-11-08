import { API, type Feed } from "@hy/types";
import { create } from "zustand";
import type { Transport } from "../lib/status";

export interface FeedState {
  feed: Feed;
  transport: Transport;
}

export type FeedEvent =
  | { kind: "open" }
  | { kind: "error" }
  | { kind: "feed"; feed: Feed };

export const INITIAL_FEED_STATE: FeedState = { feed: { kind: "connecting" }, transport: "connecting" };

export function reduceFeed(state: FeedState, event: FeedEvent): FeedState {
  switch (event.kind) {
    case "open":
      return state.transport === "open" ? state : { ...state, transport: "open" };
    case "error":
      return state.transport === "reconnecting" ? state : { ...state, transport: "reconnecting" };
    case "feed":
      return { feed: event.feed, transport: "open" };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export const useFeedStore = create<FeedState>(() => INITIAL_FEED_STATE);

const dispatch = (event: FeedEvent) => useFeedStore.setState((s) => reduceFeed(s, event), true);

export function connectFeed(): () => void {
  const es = new EventSource(API.feed);
  es.onopen = () => dispatch({ kind: "open" });
  es.onerror = () => dispatch({ kind: "error" });
  es.addEventListener("feed", (e) => {
    dispatch({ kind: "feed", feed: JSON.parse((e as MessageEvent<string>).data) as Feed });
  });
  return () => es.close();
}
