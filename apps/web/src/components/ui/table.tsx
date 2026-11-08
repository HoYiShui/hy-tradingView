import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Table({ className, containerClassName, ...props }: ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div className={cn("overflow-x-auto", containerClassName)}>
      <table className={cn("w-full whitespace-nowrap text-xs", className)} {...props} />
    </div>
  );
}

export const TableHeader = (props: ComponentProps<"thead">) => <thead {...props} />;
export const TableBody = (props: ComponentProps<"tbody">) => <tbody {...props} />;

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border last:border-0 hover:bg-white/[0.04]", className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn("sticky top-0 bg-card px-1.5 py-1 text-left font-medium text-muted-foreground", className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-1.5 py-[3px]", className)} {...props} />;
}
