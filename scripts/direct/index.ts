import type { ExchangeCredentials } from "../../apps/server/src/config.js";
import { directBackpack } from "./backpack.js";
import { directHyperliquid } from "./hyperliquid.js";
import type { Direct } from "./types.js";

export type { Direct, DirectPosition, Transfers } from "./types.js";

export function directFor(credentials: ExchangeCredentials): Direct {
  switch (credentials.exchange) {
    case "backpack":
      return directBackpack(credentials);
    case "hyperliquid":
      return directHyperliquid(credentials);
    default: {
      const _exhaustive: never = credentials;
      return _exhaustive;
    }
  }
}
