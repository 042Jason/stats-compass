"use client";

import * as React from "react";
import { ExternalLink, Search, Star, Table2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { StatisticTableRow } from "@/lib/types";
import { formatPeriod } from "@/lib/format";
import { EmptyState } from "@/components/shared/empty-state";
import { KOSIS_HOME } from "@/lib/constants";
import { cn } from "@/lib/utils";

function kosisTableUrl(t: StatisticTableRow): string | null {
  if (t.kosis_url && /^https?:\/\//.test(t.kosis_url)) return t.kosis_url;
  if (t.kosis_org_id && t.kosis_tbl_id) {
    return `${KOSIS_HOME}/statHtml/statHtml.do?orgId=${encodeURIComponent(t.kosis_org_id)}&tblId=${encodeURIComponent(t.kosis_tbl_id)}`;
  }
  return null;
}

/** 조사 상세의 통계표 목록 — 표 이름·분류 경로로 즉시 필터 */
export function TableList({ tables, statName }: { tables: StatisticTableRow[]; statName: string }) {
  const [filter, setFilter] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  const INITIAL = 30;

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter(
      (t) =>
        t.table_name.toLowerCase().includes(q) ||
        (t.category_path ?? "").toLowerCase().includes(q) ||
        (t.kosis_tbl_id ?? "").toLowerCase().includes(q),
    );
  }, [tables, filter]);

  const visible = showAll || filter ? filtered : filtered.slice(0, INITIAL);
  const representative = tables.filter((t) => t.is_representative).length;

  if (tables.length === 0) {
    return (
      <EmptyState
        icon={Table2}
        compact
        title="등록된 통계표가 없습니다"
        description="이 통계의 통계표 정보는 아직 수집되지 않았습니다. KOSIS에서 직접 확인하실 수 있습니다."
        action={{ href: `${KOSIS_HOME}/search/search.do?query=${encodeURIComponent(statName)}`, label: "KOSIS에서 검색" }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          총 <strong className="text-foreground">{tables.length.toLocaleString("ko-KR")}</strong>개 통계표
          {representative > 0 && (
            <>
              {" "}
              · 대표표 <strong className="text-foreground">{representative}</strong>개
            </>
          )}
        </p>
        {tables.length > 8 && (
          <div className="relative w-full sm:max-w-xs">
            <label htmlFor="table-filter" className="sr-only">
              통계표 이름으로 찾기
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="table-filter"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="통계표 이름으로 찾기"
              className="h-9 pl-9"
            />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          &lsquo;{filter}&rsquo;에 해당하는 통계표가 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border" role="list">
          {visible.map((t) => {
            const url = kosisTableUrl(t);
            const period = formatPeriod(t.latest_period);
            return (
              <li key={t.id} className={cn("flex items-start gap-3 px-4 py-3", t.is_representative && "bg-primary-soft/40")}>
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                    t.is_representative ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {t.is_representative ? <Star className="size-3.5" /> : <Table2 className="size-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {t.table_name}
                        <ExternalLink className="ml-1 inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden />
                        <span className="sr-only">(KOSIS 새 창)</span>
                      </a>
                    ) : (
                      <span className="font-medium">{t.table_name}</span>
                    )}
                    {t.is_representative && <Badge variant="soft">대표표</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {t.category_path && <span>{t.category_path}</span>}
                    {t.kosis_tbl_id && <span className="font-mono">{t.kosis_tbl_id}</span>}
                    {period && <span>최신 {period}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!showAll && !filter && filtered.length > INITIAL && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-4 w-full rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-accent"
        >
          나머지 {filtered.length - INITIAL}개 통계표 모두 보기
        </button>
      )}
    </div>
  );
}
