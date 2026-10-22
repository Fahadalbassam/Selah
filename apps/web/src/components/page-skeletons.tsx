import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * Loading placeholders shaped like the pages they stand in for, so content
 * settles into place instead of jumping. Used by each route's loading.tsx.
 */

export function LoadingRegion({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  return (
    <div role="status" aria-busy className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      {children}
    </div>
  );
}

export function HeaderSkeleton({ action = false, description = true }: { action?: boolean; description?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        {description ? <Skeleton className="h-4 w-72" /> : null}
      </div>
      {action ? <Skeleton className="h-9 w-32" /> : null}
    </div>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card p-5 shadow-xs">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-14" />
          <Skeleton className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex gap-6 border-b bg-muted/50 px-4 py-3">
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className={cn("h-4", c === 0 ? "w-40 flex-1" : "w-20")} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b px-4 py-3 last:border-0">
          {Array.from({ length: cols }, (_, c) =>
            c === 0 ? (
              <div key={c} className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            ) : (
              <Skeleton key={c} className={cn("h-4", c === cols - 1 ? "w-20 rounded-full" : "w-20")} />
            ),
          )}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card p-5 shadow-xs">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-4 h-2 w-full rounded-full" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-xl border bg-card p-5 shadow-xs", className)}>
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", ["w-full", "w-11/12", "w-4/5", "w-3/5"][i % 4])} />
      ))}
    </div>
  );
}

/** A main column with a narrower side panel, as on the detail pages. */
export function DetailSkeleton({ side = "20rem" }: { side?: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_var(--side)]" style={{ "--side": side } as React.CSSProperties}>
      <div className="space-y-6">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={3} />
      </div>
      <CardSkeleton lines={5} className="h-fit" />
    </div>
  );
}
