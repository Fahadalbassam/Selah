import { CardSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton action />
      <CardSkeleton lines={8} />
    </LoadingRegion>
  );
}
