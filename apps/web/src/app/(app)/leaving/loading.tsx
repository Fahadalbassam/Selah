import { CardSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <CardSkeleton className="max-w-3xl" />
    </LoadingRegion>
  );
}
