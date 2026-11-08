import { afterEach, describe, expect, it, vi } from "vitest";
import { Address } from "./address.js";
import { createHyperliquidClient, HyperliquidHttpError } from "./client.js";

const user = Address.parse("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
const request = { type: "userAbstraction", user } as const;
const client = () => createHyperliquidClient({ baseUrl: "https://hl.invalid", sleepMs: async () => undefined });

afterEach(() => vi.unstubAllGlobals());

describe("hyperliquid client", () => {
  it("posts to /info only and returns parsed json", async () => {
    const fetchMock = vi.fn(async () => new Response('"unifiedAccount"'));
    vi.stubGlobal("fetch", fetchMock);
    expect(await client().info(request)).toBe("unifiedAccount");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/info");
    expect(init.method).toBe("POST");
  });

  it("retries a reset connection and a rate limit, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await client().info(request)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after five attempts on a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().info(request)).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not retry a client error", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().info(request)).rejects.toBeInstanceOf(HyperliquidHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
