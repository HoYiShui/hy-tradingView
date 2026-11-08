import { describe, expect, it } from "vitest";
import { Address } from "./address.js";

const CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

describe("Address", () => {
  it("accepts a valid checksum and single-case forms", () => {
    expect(Address.safeParse(CHECKSUMMED).success).toBe(true);
    expect(Address.safeParse(CHECKSUMMED.toLowerCase()).success).toBe(true);
    expect(Address.safeParse(`0x${CHECKSUMMED.slice(2).toUpperCase()}`).success).toBe(true);
  });

  it("rejects a wrong checksum, wrong length and non hex", () => {
    expect(Address.safeParse(CHECKSUMMED.replace("5aAe", "5aae")).success).toBe(false);
    expect(Address.safeParse(CHECKSUMMED.slice(0, 20)).success).toBe(false);
    expect(Address.safeParse(`0x${"g".repeat(40)}`).success).toBe(false);
    expect(Address.safeParse(CHECKSUMMED.slice(2)).success).toBe(false);
  });
});
