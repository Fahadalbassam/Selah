import { DetailSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton action />
      <DetailSkeleton side="22rem" />
    </LoadingRegion>
  );
}
