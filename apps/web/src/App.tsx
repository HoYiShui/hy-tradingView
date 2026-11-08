import { API, type AccountInfo, type DailyPnl, type Fill } from "@hy/types";
import { useEffect, type ReactNode } from "react";
import { Notice } from "./components/AccountsGate";
import { Attribution } from "./components/Attribution";
import { AccountSwitcher } from "./components/AccountSwitcher";
import { FillsTable } from "./components/FillsTable";
import { Header } from "./components/Header";
import { OrdersTable } from "./components/OrdersTable";
import { PerformancePanel } from "./components/PerformancePanel";
import { PositionsTable } from "./components/PositionsTable";
import { PriceChart } from "./components/PriceChart";
import { StatTiles } from "./components/StatTiles";
import { TooltipProvider } from "./components/ui/tooltip";
import { AccountProvider, useAccount } from "./hooks/useAccount";
import { useSelectedAccount } from "./hooks/useAccounts";
import { useNow } from "./hooks/useNow";
import { usePolled } from "./hooks/usePolled";
import { accountsOn } from "./lib/accounts";
import { connectFeed } from "./store/feedStore";

const NO_FILLS: Fill[] = [];
const NO_PNL: DailyPnl[] = [];

function Dashboard({ switcher }: { switcher: ReactNode }) {
  const { id } = useAccount();
  const now = useNow();
  const fills = usePolled<Fill[]>(`${API.account(id, "fills")}?limit=200`, 10_000, NO_FILLS);
  const pnl = usePolled<DailyPnl[]>(API.account(id, "dailyPnl"), 30_000, NO_PNL);
  useEffect(() => connectFeed(id), [id]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="mx-auto max-w-[1680px] px-2 pb-8 pt-2 sm:px-4 sm:pt-3">
        <Header now={now} switcher={switcher} />
        <main>
          <StatTiles />
          <div className="grid grid-cols-1 items-start gap-2 lg:grid-cols-12">
            <div className="contents lg:col-span-6 lg:flex lg:min-w-0 lg:flex-col lg:gap-2">
              <PriceChart className="order-1 lg:order-none" />
              <PerformancePanel days={pnl.data} loaded={pnl.loaded} error={pnl.error} className="order-3 lg:order-none" />
            </div>
            <div className="contents lg:col-span-6 lg:flex lg:min-w-0 lg:flex-col lg:gap-2">
              <PositionsTable className="order-2 lg:order-none" />
              <OrdersTable className="order-2 lg:order-none" />
              <FillsTable fills={fills.data} loaded={fills.loaded} error={fills.error} className="order-4 lg:order-none" />
            </div>
          </div>
        </main>
        <Attribution />
      </div>
    </TooltipProvider>
  );
}

export function App({ accounts }: { accounts: AccountInfo[] }) {
  const [account, select] = useSelectedAccount(accounts, "dashboard");
  if (account === null) return <Notice tone="error">No account is configured for the dashboard.</Notice>;
  const switcher = <AccountSwitcher accounts={accountsOn(accounts, "dashboard")} selected={account.id} onSelect={select} />;
  return (
    <AccountProvider key={account.id} value={account}>
      <Dashboard switcher={switcher} />
    </AccountProvider>
  );
}
