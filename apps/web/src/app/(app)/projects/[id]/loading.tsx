import { CardSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton action />
      <Skeleton className="h-9 w-72" />
      <CardSkeleton lines={3} />
      <CardSkeleton lines={3} />
    </LoadingRegion>
  );
}
