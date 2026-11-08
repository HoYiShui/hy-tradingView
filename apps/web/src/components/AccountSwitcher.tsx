import type { AccountInfo } from "@hy/types";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export function AccountSwitcher({ accounts, selected, onSelect }: { accounts: readonly AccountInfo[]; selected: string; onSelect: (id: string) => void }) {
  if (accounts.length < 2) return null;
  return (
    <Tabs value={selected} onValueChange={onSelect}>
      <TabsList aria-label="Account">
        {accounts.map((a) => <TabsTrigger key={a.id} value={a.id}>{a.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
}
