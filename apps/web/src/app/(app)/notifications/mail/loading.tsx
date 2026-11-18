import { CardSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <CardSkeleton lines={6} />
      <CardSkeleton lines={2} />
    </LoadingRegion>
  );
}
