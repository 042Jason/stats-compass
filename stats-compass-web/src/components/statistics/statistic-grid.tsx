import type { StatisticRow } from "@/lib/types";
import { StatisticCard } from "./statistic-card";
import { cn } from "@/lib/utils";

export function StatisticGrid({
  items,
  compact,
  className,
}: {
  items: StatisticRow[];
  compact?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)} role="list">
      {items.map((s) => (
        <li key={s.id} className="h-full">
          <StatisticCard statistic={s} compact={compact} />
        </li>
      ))}
    </ul>
  );
}
