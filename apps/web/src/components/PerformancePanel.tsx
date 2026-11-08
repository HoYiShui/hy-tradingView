import type { DailyPnl } from "@hy/types";
import { useState } from "react";
import { EquityChart } from "./EquityChart";
import { PnlChart } from "./PnlChart";
import { Panel } from "./Panel";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

type View = "equity" | "daily";

export function PerformancePanel({ days, loaded, error, className }: { days: readonly DailyPnl[]; loaded: boolean; error: string | null; className?: string }) {
  const [view, setView] = useState<View>("equity");
  return (
    <Panel
      title={view === "equity" ? "Equity" : "Daily realized PnL"}
      className={className}
      aside={
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList aria-label="Performance view">
            <TabsTrigger value="equity">Equity</TabsTrigger>
            <TabsTrigger value="daily">Daily PnL</TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      {view === "equity" ? <EquityChart /> : <PnlChart days={days} loaded={loaded} error={error} />}
    </Panel>
  );
}
