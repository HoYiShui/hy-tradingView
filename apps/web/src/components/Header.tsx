import { CircleAlert, CircleCheck, CircleDashed, CircleX, type LucideIcon } from "lucide-react";
import { relativeAge, utcTime } from "../lib/format";
import { snapshotOf, statusOf, type StatusTone } from "../lib/status";
import { cn } from "../lib/utils";
import { useFeedStore } from "../store/feedStore";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const TONE: Record<StatusTone, { icon: LucideIcon; color: string }> = {
  ok: { icon: CircleCheck, color: "text-good" },
  warn: { icon: CircleAlert, color: "text-warn" },
  bad: { icon: CircleX, color: "text-crit" },
  pending: { icon: CircleDashed, color: "text-muted-foreground" },
};

export function Header({ now }: { now: number }) {
  const feed = useFeedStore((s) => s.feed);
  const transport = useFeedStore((s) => s.transport);
  const status = statusOf(feed, transport);
  const snap = snapshotOf(feed);
  const { icon: Icon, color } = TONE[status.tone];
  return (
    <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-base font-semibold text-foreground">
        Backpack <span className="font-normal text-muted-foreground">perp account</span>
      </h1>
      <div className="flex items-center gap-3 text-xs">
        <Badge role="status" className="rounded-full px-2.5 font-medium">
          <Icon className={cn("size-3.5", color)} aria-hidden="true" />
          {status.label}
          {status.detail !== null && <span className="max-w-[360px] truncate font-normal text-secondary-foreground">{status.detail}</span>}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="num cursor-default text-muted-foreground">
              {snap ? `Updated ${relativeAge(snap.asOf, now)}` : "No data yet"}
            </span>
          </TooltipTrigger>
          {snap && <TooltipContent>{utcTime(snap.asOf)} UTC</TooltipContent>}
        </Tooltip>
      </div>
    </header>
  );
}
