import { CardSkeleton, HeaderSkeleton, LoadingRegion, TableSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <CardSkeleton lines={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
      <TableSkeleton rows={3} cols={5} />
      <CardSkeleton lines={2} />
    </LoadingRegion>
  );
}
