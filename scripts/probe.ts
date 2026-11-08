import { loadAccount } from "./account.js";
import { probeBackpack } from "./probe-backpack.js";
import { probeHyperliquid } from "./probe-hyperliquid.js";

const { account } = loadAccount(process.argv[2]);
const { credentials } = account;
switch (credentials.exchange) {
  case "backpack":
    await probeBackpack(account.id, credentials);
    break;
  case "hyperliquid":
    await probeHyperliquid(credentials);
    break;
  default: {
    const _exhaustive: never = credentials;
    throw new Error(String(_exhaustive));
  }
}
