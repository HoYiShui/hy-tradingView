import { API, type DailyPnl, type Fill } from "@hy/types";
import { useEffect } from "react";
import { FillsTable } from "./components/FillsTable";
import { Header } from "./components/Header";
import { OrdersTable } from "./components/OrdersTable";
import { PnlChart } from "./components/PnlChart";
import { PositionsTable } from "./components/PositionsTable";
import { PriceChart } from "./components/PriceChart";
import { StatTiles } from "./components/StatTiles";
import { TooltipProvider } from "./components/ui/tooltip";
import { useNow } from "./hooks/useNow";
import { usePolled } from "./hooks/usePolled";
import { connectFeed } from "./store/feedStore";

const NO_FILLS: Fill[] = [];
const NO_PNL: DailyPnl[] = [];

export function App() {
  const now = useNow();
  const fills = usePolled<Fill[]>(`${API.fills}?limit=200`, 10_000, NO_FILLS);
  const pnl = usePolled<DailyPnl[]>(API.dailyPnl, 30_000, NO_PNL);
  useEffect(connectFeed, []);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="mx-auto max-w-[1680px] px-2 pb-8 pt-2 sm:px-4 sm:pt-3">
        <Header now={now} />
        <main>
          <StatTiles />
          <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-12">
            <div className="contents lg:col-span-6 lg:flex lg:min-w-0 lg:flex-col lg:gap-2">
              <PriceChart fills={fills.data} className="order-1 lg:order-none" />
              <PnlChart days={pnl.data} loaded={pnl.loaded} error={pnl.error} className="order-3 lg:order-none" />
            </div>
            <div className="contents lg:col-span-6 lg:flex lg:min-w-0 lg:flex-col lg:gap-2">
              <PositionsTable className="order-2 lg:order-none" />
              <OrdersTable className="order-2 lg:order-none" />
              <FillsTable fills={fills.data} loaded={fills.loaded} error={fills.error} className="order-4 lg:order-none" />
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
