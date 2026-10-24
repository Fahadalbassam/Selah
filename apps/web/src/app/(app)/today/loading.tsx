import { HeaderSkeleton, LoadingRegion, TableSkeleton } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      {[3, 4, 2].map((rows, i) => (
        <div key={i} className="space-y-3">
          <div className="space-y-1">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-80" />
          </div>
          <TableSkeleton rows={rows} cols={3} />
        </div>
      ))}
    </LoadingRegion>
  );
}
