import { CardGridSkeleton, CardSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <CardSkeleton lines={2} />
      <CardGridSkeleton count={4} />
    </LoadingRegion>
  );
}
