import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-border px-1.5 text-xs leading-[18px] text-foreground", className)}
      {...props}
    />
  );
}
