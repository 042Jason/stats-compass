import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function StatisticCardSkeleton() {
  return (
    <Card className="gap-3" aria-hidden>
      <Skeleton className="h-5 w-16" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <div className="mt-2 flex gap-3">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3.5 w-12" />
      </div>
    </Card>
  );
}

export function StatisticGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="불러오는 중">
      {Array.from({ length: count }).map((_, i) => (
        <StatisticCardSkeleton key={i} />
      ))}
    </div>
  );
}
