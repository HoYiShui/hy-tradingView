const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const priceFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
const qtyFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 5 });

export type Sign = "gain" | "loss" | "flat";

export function signOf(n: number): Sign {
  if (n > 0) return "gain";
  if (n < 0) return "loss";
  return "flat";
}

export const SIGN_MARK: Record<Sign, string> = { gain: "▲", loss: "▼", flat: "–" };
export const SIGN_WORD: Record<Sign, string> = { gain: "gain", loss: "loss", flat: "flat" };

export function usd(n: number): string {
  return usdFmt.format(Object.is(n, -0) ? 0 : n);
}

export function compactUsd(n: number): string {
  return Math.abs(n) >= 100_000 ? compactFmt.format(n) : usd(n);
}

export function signedUsd(n: number): string {
  const s = signOf(n);
  if (s === "flat") return usd(0);
  return `${s === "gain" ? "+" : "-"}${usd(Math.abs(n))}`;
}

export function price(n: number): string {
  return priceFmt.format(n);
}

export function qty(n: number): string {
  return qtyFmt.format(n);
}

export function leverageX(n: number | null): string {
  return n === null ? "-" : `${n.toFixed(2)}x`;
}

export function percent(fraction: number | null): string {
  return fraction === null ? "-" : `${(fraction * 100).toFixed(2)}%`;
}

export function utcTime(ms: number): string {
  return new Date(ms).toISOString().slice(5, 19).replace("T", " ");
}

export function relativeAge(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function shortSymbol(symbol: string): string {
  return symbol.replace(/_USDC_PERP$/, "-PERP");
}
