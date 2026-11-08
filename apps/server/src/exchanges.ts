import { createBackpackReader } from "./backpack/adapter.js";
import { createBackpackClient } from "./backpack/client.js";
import type { AccountConfig } from "./config.js";
import type { ExchangeReader } from "./exchange.js";

export function createReader({ credentials }: AccountConfig): ExchangeReader {
  switch (credentials.exchange) {
    case "backpack":
      return createBackpackReader(
        createBackpackClient({ baseUrl: credentials.apiUrl, apiKey: credentials.apiKey, apiSecret: credentials.apiSecret }),
      );
    default: {
      const _exhaustive: never = credentials.exchange;
      return _exhaustive;
    }
  }
}
