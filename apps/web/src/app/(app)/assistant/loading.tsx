import { HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <HeaderSkeleton />
      <Skeleton className="h-[28rem] w-full rounded-xl" />
    </LoadingRegion>
  );
}
