import { HeaderSkeleton, LoadingRegion, TableSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton action />
      <TableSkeleton />
    </LoadingRegion>
  );
}
