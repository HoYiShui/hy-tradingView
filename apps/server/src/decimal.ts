import { z } from "zod";

export const decimal = z.string().transform((s, ctx) => {
  const n = Number(s);
  if (s.trim() === "" || !Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: `not a decimal: ${s}` });
    return z.NEVER;
  }
  return n;
});
