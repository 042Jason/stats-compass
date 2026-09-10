import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatisticGrid } from "@/components/statistics/statistic-grid";
import { getCategoryMeta } from "@/lib/categories";
import { getCategorySummaries, getStatistics } from "@/lib/queries/statistics";
import type { BrowseSort } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "통계 찾기",
  description: "국가데이터처 승인통계를 분야별로 살펴보고 정렬해 찾아보세요.",
};

export const revalidate = 300;

const SORT_OPTIONS: { value: BrowseSort; label: string }[] = [
  { value: "name", label: "이름순" },
  { value: "recent", label: "최근 갱신순" },
  { value: "agency", label: "기관순" },
];

type SearchParams = Promise<{ category?: string; sort?: string; page?: string }>;

function parseSort(v: string | undefined): BrowseSort {
  return SORT_OPTIONS.some((o) => o.value === v) ? (v as BrowseSort) : "name";
}

function href(params: { category?: string; sort?: BrowseSort; page?: number }) {
  const sp = new URLSearchParams();
  if (params.category) sp.set("category", params.category);
  if (params.sort && params.sort !== "name") sp.set("sort", params.sort);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/browse?${qs}` : "/browse";
}

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const category = sp.category?.trim() || undefined;
  const sort = parseSort(sp.sort);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const [categories, result] = await Promise.all([
    getCategorySummaries(),
    getStatistics({ category, sort, page }),
  ]);

  const currentMeta = category ? getCategoryMeta(category) : null;

  return (
    <>
      <PageHeader
        eyebrow="통계 찾기"
        title={currentMeta ? `${currentMeta.label} 분야 통계` : "전체 승인통계"}
        description={
          currentMeta
            ? currentMeta.description || `${currentMeta.label} 분야에 속한 승인통계 목록입니다.`
            : "국가데이터처와 각 기관이 작성하는 승인통계를 분야별로 찾아볼 수 있습니다. 통계를 선택하면 작성 목적, 법적 근거, KOSIS 통계표 목록을 확인할 수 있습니다."
        }
      />

      <div className="container-page py-8 md:py-10">
        {/* 분야 필터 */}
        <nav aria-label="분야 필터" className="mb-6">
          <ul className="flex flex-wrap gap-2" role="list">
            <li>
              <FilterChip href={href({ sort })} active={!category}>
                전체
              </FilterChip>
            </li>
            {categories.error === null &&
              categories.data.map((c) => (
                <li key={c.category}>
                  <FilterChip href={href({ category: c.category, sort })} active={category === c.category}>
                    {getCategoryMeta(c.category).label}
                    <span className="ml-1 text-xs opacity-70">{c.count}</span>
                  </FilterChip>
                </li>
              ))}
          </ul>
        </nav>

        {/* 결과 요약 + 정렬 */}
        <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground" role="status">
            {result.error !== null ? (
              "통계 목록"
            ) : (
              <>
                총 <strong className="text-foreground">{result.data.total.toLocaleString("ko-KR")}</strong>개 통계
                {result.data.totalPages > 1 && (
                  <>
                    {" "}
                    · {result.data.page} / {result.data.totalPages} 페이지
                  </>
                )}
              </>
            )}
          </p>
          <div className="flex items-center gap-1" role="group" aria-label="정렬">
            {SORT_OPTIONS.map((o) => (
              <Link
                key={o.value}
                href={href({ category, sort: o.value })}
                aria-current={sort === o.value ? "true" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  sort === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-primary",
                )}
              >
                {o.label}
              </Link>
            ))}
          </div>
        </div>

        {result.error !== null ? (
          <ErrorState detail={result.error} />
        ) : result.data.items.length === 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title="해당하는 통계가 없습니다"
            description={category ? "다른 분야를 선택하거나 전체 목록에서 찾아보세요." : "통계 데이터가 적재되면 이곳에 표시됩니다."}
            action={category ? { href: "/browse", label: "전체 통계 보기" } : undefined}
          />
        ) : (
          <>
            <StatisticGrid items={result.data.items} />
            <Pagination
              page={result.data.page}
              totalPages={result.data.totalPages}
              params={{ category, sort: sort === "name" ? undefined : sort }}
              basePath="/browse"
            />
          </>
        )}
      </div>
    </>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/50 hover:text-primary",
      )}
    >
      {children}
    </Link>
  );
}
