import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="border-b border-border bg-muted/40">
        <div className="container-page py-8 md:py-10">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="mt-5 h-6 w-20" />
          <Skeleton className="mt-3 h-9 w-2/3" />
          <Skeleton className="mt-3 h-4 w-40" />
        </div>
      </div>
      <div className="container-page grid gap-10 py-10 lg:grid-cols-[1fr_300px]" aria-busy="true">
        <div className="space-y-6">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <div className="space-y-5">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </>
  );
}
