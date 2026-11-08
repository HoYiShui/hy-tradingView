import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function Panel({ title, aside, className, children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {aside}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded border border-dashed border-border px-3 py-6 text-center text-muted-foreground">{children}</div>;
}
