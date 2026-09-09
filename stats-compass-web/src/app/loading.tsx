import { Skeleton } from "@/components/ui/skeleton";
import { StatisticGridSkeleton } from "@/components/statistics/statistic-card-skeleton";

export default function Loading() {
  return (
    <div className="container-page py-10" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8">
        <StatisticGridSkeleton />
      </div>
    </div>
  );
}
