import { HeaderSkeleton, LoadingRegion, StatCardsSkeleton, TableSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <StatCardsSkeleton count={4} />
      <TableSkeleton rows={6} cols={8} />
      <TableSkeleton rows={6} cols={5} />
    </LoadingRegion>
  );
}
