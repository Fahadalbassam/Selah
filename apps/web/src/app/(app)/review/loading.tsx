import { HeaderSkeleton, LoadingRegion, TableSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <TableSkeleton rows={8} cols={6} />
    </LoadingRegion>
  );
}
