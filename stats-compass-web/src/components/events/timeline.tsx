import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TimelineItem } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { CategoryBadge } from "@/components/statistics/category-badge";

export interface TimelineEntry extends TimelineItem {
  statistic?: { stat_id: string; name_ko: string; category: string | null } | null;
}

const TYPE_LABELS: Record<string, string> = {
  new: "신규",
  new_statistic: "신규 승인",
  approved: "승인",
  revised: "개편",
  revision: "개편",
  changed: "변경",
  renamed: "명칭 변경",
  discontinued: "중지",
  suspended: "중지",
  resumed: "재개",
  table_added: "통계표 추가",
  table_updated: "통계표 갱신",
  data_updated: "자료 갱신",
  update: "갱신",
  notice: "안내",
};

function typeLabel(t: string | null) {
  if (!t) return null;
  return TYPE_LABELS[t.toLowerCase()] ?? t;
}

/** 연혁/이벤트 공용 세로 타임라인 */
export function Timeline({ items, showStatistic = false }: { items: TimelineEntry[]; showStatistic?: boolean }) {
  return (
    <ol className="relative border-l border-border pl-6" role="list">
      {items.map((it) => {
        const label = typeLabel(it.type);
        return (
          <li key={it.id} className="relative pb-8 last:pb-0">
            <span className="absolute -left-[31px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {it.date && <time dateTime={it.date}>{formatDate(it.date)}</time>}
              {label && <Badge variant="soft">{label}</Badge>}
              {showStatistic && it.statistic?.category && <CategoryBadge category={it.statistic.category} />}
            </div>
            <p className="mt-1 font-semibold leading-snug">{it.title}</p>
            {showStatistic && it.statistic && (
              <p className="mt-0.5 text-sm">
                <Link href={`/statistics/${encodeURIComponent(it.statistic.stat_id)}`} className="text-primary hover:underline">
                  {it.statistic.name_ko}
                </Link>
              </p>
            )}
            {it.description && <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{it.description}</p>}
            {it.sourceUrl && (
              <a
                href={it.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                출처 보기 <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only">(새 창)</span>
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}
