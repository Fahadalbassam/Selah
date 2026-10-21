import { HeaderSkeleton, LoadingRegion, StatCardsSkeleton, TableSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton description={false} />
      <StatCardsSkeleton />
      <TableSkeleton rows={5} cols={5} />
    </LoadingRegion>
  );
}
