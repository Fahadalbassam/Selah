import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A labelled number, with an optional line of context under it, on the grey summary surface. */
export function StatTile({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1 rounded-xl border bg-surface px-4 py-3 text-surface-foreground", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A share of a whole, filled from the reading direction's start. */
export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
