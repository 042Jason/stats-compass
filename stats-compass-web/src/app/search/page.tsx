import type { Metadata } from "next";
import Link from "next/link";
import { Database, ExternalLink, SearchX, Table2, Search } from "lucide-react";
import { SearchBox } from "@/components/search/search-box";
import { Highlight } from "@/components/search/highlight";
import { CategoryBadge } from "@/components/statistics/category-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { normalizeQuery, searchAll } from "@/lib/queries/search";
import { getCategorySummaries } from "@/lib/queries/statistics";
import { getCategoryMeta } from "@/lib/categories";
import type { SearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "검색",
  description: "통계명, 통계표명, 작성기관으로 승인통계를 검색합니다.",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; type?: string }>;
type Kind = "all" | "statistic" | "table";

const KIND_TABS: { value: Kind; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "statistic", label: "통계" },
  { value: "table", label: "통계표" },
];

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = normalizeQuery(sp.q);
  const kind: Kind = KIND_TABS.some((t) => t.value === sp.type) ? (sp.type as Kind) : "all";

  if (!q) return <SearchLanding />;

  const result = await searchAll(q, 60);
  const statHits = result.hits.filter((h) => h.kind === "statistic");
  const tableHits = result.hits.filter((h) => h.kind === "table");
  const visible = kind === "all" ? result.hits : kind === "statistic" ? statHits : tableHits;

  const tabHref = (k: Kind) => `/search?q=${encodeURIComponent(q)}${k === "all" ? "" : `&type=${k}`}`;

  return (
    <>
      <div className="border-b border-border bg-muted/40">
        <div className="container-page py-8 md:py-10">
          <p className="mb-2 text-sm font-semibold text-primary">통합 검색</p>
          <div className="max-w-2xl">
            <SearchBox />
          </div>
          <p className="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
            &lsquo;<strong className="text-foreground">{q}</strong>&rsquo; 검색 결과{" "}
            <strong className="text-foreground">{result.hits.length.toLocaleString("ko-KR")}</strong>건
            <span className="ml-2 text-xs">(통계 {statHits.length} · 통계표 {tableHits.length})</span>
          </p>
        </div>
      </div>

      <div className="container-page py-8">
        <div className="mb-6 flex items-center gap-1 border-b border-border" role="tablist" aria-label="결과 구분">
          {KIND_TABS.map((t) => {
            const active = kind === t.value;
            const count = t.value === "all" ? result.hits.length : t.value === "statistic" ? statHits.length : tableHits.length;
            return (
              <Link
                key={t.value}
                href={tabHref(t.value)}
                role="tab"
                aria-selected={active}
                className={cn(
                  "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-primary-soft text-primary" : "bg-muted")}>{count}</span>
              </Link>
            );
          })}
        </div>

        {result.error && result.hits.length === 0 ? (
          <ErrorState title="검색을 수행하지 못했습니다" detail={result.error} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="검색 결과가 없습니다"
            description="다른 검색어로 시도하거나, 띄어쓰기를 바꾸거나 더 짧은 단어로 검색해 보세요. 분야별 찾기에서 통계를 둘러볼 수도 있습니다."
            action={{ href: "/browse", label: "분야별로 찾기" }}
          />
        ) : (
          <ul className="space-y-3" role="list">
            {visible.map((h) => (
              <li key={`${h.kind}-${h.id}`}>
                <SearchResultCard hit={h} query={q} />
              </li>
            ))}
          </ul>
        )}

        {result.mode === "fallback" && result.hits.length > 0 && (
          <p className="mt-8 text-xs text-muted-foreground">
            * 검색 함수(search_all)가 아직 적용되지 않아 기본 검색 방식으로 표시했습니다.
          </p>
        )}
      </div>
    </>
  );
}

function SearchResultCard({ hit, query }: { hit: SearchHit; query: string }) {
  const isStat = hit.kind === "statistic";
  const detailHref = hit.statId ? `/statistics/${encodeURIComponent(hit.statId)}` : null;
  const Icon = isStat ? Database : Table2;

  return (
    <article className="group relative flex gap-4 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-[0_4px_16px_rgba(0,56,118,0.10)] md:p-5">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          isStat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn("font-semibold", isStat ? "text-primary" : "text-muted-foreground")}>{isStat ? "통계" : "통계표"}</span>
          {hit.category && <CategoryBadge category={hit.category} />}
        </div>
        <h3 className="mt-1.5 text-base font-semibold leading-snug">
          {detailHref ? (
            <Link href={detailHref} className="after:absolute after:inset-0 after:content-[''] hover:text-primary">
              <Highlight text={hit.title} query={query} />
            </Link>
          ) : (
            <Highlight text={hit.title} query={query} />
          )}
        </h3>
        {hit.subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">
            {isStat ? "작성기관: " : "소속 통계: "}
            <Highlight text={hit.subtitle} query={query} />
          </p>
        )}
      </div>
      {!isStat && hit.kosisUrl && (
        <a
          href={hit.kosisUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 hidden shrink-0 items-center gap-1 self-center rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent hover:text-primary sm:inline-flex"
        >
          KOSIS <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">(새 창)</span>
        </a>
      )}
    </article>
  );
}

async function SearchLanding() {
  const cats = await getCategorySummaries();
  const examples = ["소비자물가", "경제활동인구", "인구총조사", "가계동향", "사업체", "출생", "주택"];
  return (
    <div className="container-page py-12 md:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Search className="size-7" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">무엇을 찾고 계신가요?</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          통계명, 통계표명, 작성기관, 태그로 승인통계를 검색합니다. 통계 마스터와 KOSIS 통계표를 함께 찾아드립니다.
        </p>
        <div className="mt-6">
          <SearchBox autoFocus />
        </div>
        <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="검색 예시">
          {examples.map((e) => (
            <li key={e}>
              <Link
                href={`/search?q=${encodeURIComponent(e)}`}
                className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary"
              >
                {e}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {cats.error === null && cats.data.length > 0 && (
        <div className="mx-auto mt-14 max-w-3xl">
          <h2 className="mb-4 text-center text-sm font-semibold text-muted-foreground">또는 분야별로 둘러보기</h2>
          <ul className="flex flex-wrap justify-center gap-2" role="list">
            {cats.data.map((c) => (
              <li key={c.category}>
                <Link
                  href={`/browse?category=${encodeURIComponent(c.category)}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:border-primary/40 hover:text-primary"
                >
                  {getCategoryMeta(c.category).label}
                  <span className="text-xs text-muted-foreground">{c.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
