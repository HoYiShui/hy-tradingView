import { useRef } from "react";
import { cn } from "../lib/utils";

export function Flash({ value, className }: { value: string; className?: string }) {
  const prev = useRef(value);
  const generation = useRef(0);
  if (prev.current !== value) {
    prev.current = value;
    generation.current += 1;
  }
  return (
    <span key={generation.current} className={cn(generation.current > 0 && "flash", className)}>
      {value}
    </span>
  );
}
