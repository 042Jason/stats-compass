import Link from "next/link";
import { Building2, CalendarClock, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryBadge } from "./category-badge";
import type { StatisticRow } from "@/lib/types";
import { toTags } from "@/lib/normalize";
import { frequencyLabel, truncate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { shortAgency } from "@/lib/agency";

interface StatisticCardProps {
  statistic: StatisticRow;
  /** 카드 하단에 표시할 부가 설명 (큐레이션 세트 노트 등) */
  note?: string | null;
  className?: string;
  compact?: boolean;
}

export function StatisticCard({ statistic: s, note, className, compact }: StatisticCardProps) {
  const tags = toTags(s.tags).slice(0, 3);
  const freq = frequencyLabel(s.frequency);
  const href = `/statistics/${encodeURIComponent(s.stat_id)}`;
  // 카드마다 길이가 들쭉날쭉하면 목록이 지저분해집니다. 두 줄에 들어오게 자릅니다.
  // summary 는 카드용으로 다듬은 문장이라 그대로 들어맞습니다.
  // 없을 때만 원문(purpose)을 잘라 씁니다.
  const summary = s.summary?.trim() || truncate(s.purpose ?? s.description ?? "", compact ? 60 : 78);
  // 이 카탈로그는 전부 국가데이터처 통계라 기관명은 빼고 과명만 보여 줍니다.
  const agency = shortAgency(s.agency);

  return (
    <Card
      className={cn(
        "group relative h-full gap-3 transition-shadow hover:shadow-[0_4px_16px_rgba(0,56,118,0.10)] focus-within:shadow-[0_4px_16px_rgba(0,56,118,0.10)]",
        compact && "p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <CategoryBadge category={s.category} />
        {s.status && s.status !== "active" && s.status !== "승인" && (
          <Badge variant="muted">{s.status}</Badge>
        )}
      </div>

      <h3 className={cn("font-semibold leading-snug", compact ? "text-[15px]" : "text-base")}>
        <Link href={href} className="after:absolute after:inset-0 after:content-[''] hover:text-primary">
          {s.name_ko}
        </Link>
      </h3>

      {/* 설명이 있는 카드와 없는 카드가 섞이면 제목·태그 줄이 카드마다 어긋납니다.
       * 두 줄 높이를 늘 잡아 두고, 없으면 그 자리를 비워 둡니다. */}
      {!compact && (
        <p className="line-clamp-2 min-h-12 text-sm leading-6 text-muted-foreground">
          {summary || <span className="text-muted-foreground/50">개요 없음</span>}
        </p>
      )}

      <dl className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {agency && (
          <div className="flex items-center gap-1">
            <dt className="sr-only">작성부서</dt>
            <Building2 className="size-3.5" aria-hidden />
            <dd>{agency}</dd>
          </div>
        )}
        {freq && (
          <div className="flex items-center gap-1">
            <dt className="sr-only">작성주기</dt>
            <CalendarClock className="size-3.5" aria-hidden />
            <dd>{freq}</dd>
          </div>
        )}
      </dl>

      {tags.length > 0 && !compact && (
        <ul className="flex flex-wrap gap-1.5" aria-label="태그">
          {tags.map((t) => (
            <li key={t}>
              <Badge variant="outline" className="font-normal text-muted-foreground">
                #{t}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="rounded-md bg-primary-soft px-3 py-2 text-sm leading-6 text-primary">{note}</p>}

      <ArrowUpRight
        className="absolute right-4 top-4 size-4 text-muted-foreground/0 transition group-hover:text-primary"
        aria-hidden
      />
    </Card>
  );
}
