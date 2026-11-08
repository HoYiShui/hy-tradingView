import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex gap-0.5", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "cursor-pointer rounded px-2 py-0.5 text-xs text-muted-foreground outline-none hover:bg-white/[0.06] hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-border data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_-2px_0_var(--primary)]",
        className,
      )}
      {...props}
    />
  );
}
