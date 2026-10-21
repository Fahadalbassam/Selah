import { CardGridSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton action />
      <CardGridSkeleton />
    </LoadingRegion>
  );
}
