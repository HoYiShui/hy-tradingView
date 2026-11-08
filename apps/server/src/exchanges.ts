import { createBackpackReader } from "./backpack/adapter.js";
import { createBackpackClient } from "./backpack/client.js";
import { createHyperliquidReader } from "./hyperliquid/adapter.js";
import { createHyperliquidClient } from "./hyperliquid/client.js";
import type { AccountConfig } from "./config.js";
import type { ExchangeReader } from "./exchange.js";

export function createReader({ credentials }: AccountConfig): ExchangeReader {
  switch (credentials.exchange) {
    case "backpack":
      return createBackpackReader(
        createBackpackClient({ baseUrl: credentials.apiUrl, apiKey: credentials.apiKey, apiSecret: credentials.apiSecret }),
      );
    case "hyperliquid":
      return createHyperliquidReader({ client: createHyperliquidClient({ baseUrl: credentials.apiUrl }), address: credentials.address });
    default: {
      const _exhaustive: never = credentials;
      return _exhaustive;
    }
  }
}
