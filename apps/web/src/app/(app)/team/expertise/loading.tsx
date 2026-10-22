import { HeaderSkeleton, LoadingRegion, TableSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <TableSkeleton rows={5} cols={5} />
    </LoadingRegion>
  );
}
