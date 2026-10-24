import { CardSkeleton, HeaderSkeleton, LoadingRegion, StatCardsSkeleton, TableSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton action />
      <StatCardsSkeleton />
      <CardSkeleton lines={2} />
      <TableSkeleton rows={8} cols={5} />
    </LoadingRegion>
  );
}
