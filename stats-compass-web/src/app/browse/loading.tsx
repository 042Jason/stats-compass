import { Skeleton } from "@/components/ui/skeleton";
import { StatisticGridSkeleton } from "@/components/statistics/statistic-card-skeleton";

export default function Loading() {
  return (
    <>
      <div className="border-b border-border bg-muted/40">
        <div className="container-page py-10 md:py-12">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-8 w-64" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
      </div>
      <div className="container-page py-8 md:py-10" aria-busy="true">
        <div className="mb-6 flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
        <StatisticGridSkeleton count={9} />
      </div>
    </>
  );
}
