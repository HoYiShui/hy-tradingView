import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";

export const Address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine(hasValidChecksum)
  .brand<"EvmAddress">();
export type Address = z.infer<typeof Address>;

function hasValidChecksum(address: string): boolean {
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  const hash = bytesToHex(keccak_256(utf8ToBytes(body.toLowerCase())));
  return [...body].every((c, i) => (/[a-f]/i.test(c) ? c === (parseInt(hash[i] ?? "0", 16) >= 8 ? c.toUpperCase() : c.toLowerCase()) : true));
}
