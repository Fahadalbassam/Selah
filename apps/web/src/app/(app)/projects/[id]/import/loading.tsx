import { CardSkeleton, HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion>
      <Skeleton className="h-4 w-40" />
      <HeaderSkeleton action />
      <Skeleton className="h-5 w-56" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={4} />
      </div>
    </LoadingRegion>
  );
}
