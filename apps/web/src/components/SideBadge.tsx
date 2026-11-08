import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";

export function SideBadge({ side }: { side: "buy" | "sell" | "long" | "short" }) {
  const up = side === "buy" || side === "long";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <Badge className={cn(up ? "text-gain" : "text-loss")}>
      <Icon className="size-3" aria-hidden="true" />
      {side === "buy" ? "Buy" : side === "sell" ? "Sell" : side === "long" ? "Long" : "Short"}
    </Badge>
  );
}
