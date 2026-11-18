import { CardSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={4} />
      </div>
      <CardSkeleton lines={4} />
    </LoadingRegion>
  );
}
