import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, BookMarked, Bell, Database, Table2 } from "lucide-react";
import { SearchBox } from "@/components/search/search-box";
import { SectionHeader } from "@/components/shared/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatisticGrid } from "@/components/statistics/statistic-grid";
import { StatisticGridSkeleton } from "@/components/statistics/statistic-card-skeleton";
import { CuratedSetCard } from "@/components/sets/curated-set-card";
import { Timeline } from "@/components/events/timeline";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getCategoryMeta } from "@/lib/categories";
import { SITE_TAGLINE } from "@/lib/constants";
import {
  getCategorySummaries,
  getRecentStatistics,
  getStatisticCount,
  getTableCount,
} from "@/lib/queries/statistics";
import { getPublishedSets, getSetItemCounts } from "@/lib/queries/sets";
import { getRecentEvents } from "@/lib/queries/events";

export const revalidate = 300;

export default function HomePage() {
  return (
    <>
      <Hero />

      <section className="container-page py-12 md:py-16" aria-labelledby="home-categories">
        <SectionHeader id="home-categories" title="분야별로 찾기" description="관심 분야를 고르면 해당 승인통계 조사 목록으로 이동합니다." moreHref="/browse" moreLabel="전체 조사 보기" />
        <Suspense fallback={<CategoryGridSkeleton />}>
          <CategorySection />
        </Suspense>
      </section>

      <section className="border-y border-border bg-muted/30" aria-labelledby="home-sets">
        <div className="container-page py-12 md:py-16">
          <SectionHeader id="home-sets" title="큐레이션 세트" description="편집자가 주제별로 골라 엮은 통계 묶음입니다." moreHref="/sets" />
          <Suspense fallback={<StatisticGridSkeleton count={3} />}>
            <SetsSection />
          </Suspense>
        </div>
      </section>

      <section className="container-page py-12 md:py-16" aria-labelledby="home-recent">
        <SectionHeader id="home-recent" title="최근 갱신된 조사" description="메타정보가 최근에 갱신된 조사입니다." moreHref="/browse?sort=recent" />
        <Suspense fallback={<StatisticGridSkeleton count={6} />}>
          <RecentSection />
        </Suspense>
      </section>

      <section className="border-t border-border bg-muted/30" aria-labelledby="home-news">
        <div className="container-page grid gap-10 py-12 md:grid-cols-[1fr_320px] md:py-16">
          <div>
            <SectionHeader id="home-news" title="What's New" description="통계 승인·개편·자료 갱신 소식을 시간순으로 안내합니다." moreHref="/whats-new" />
            <Suspense fallback={<TimelineSkeleton />}>
              <NewsSection />
            </Suspense>
          </div>
          <aside className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                <BookMarked className="size-4" aria-hidden /> Deep Dive
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                한 조사를 깊이 들여다보는 심층 소개 아티클입니다. 작성 목적, 조사 방식, 읽을 때 주의할 점을 다룹니다.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/deep-dives">
                  아티클 보기 <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Bell className="size-4" aria-hidden /> 이용 안내
              </p>
              <ul className="mt-2 space-y-1.5 text-sm leading-6 text-muted-foreground">
                <li>· 본 사이트는 통계의 <strong className="text-foreground">안내와 탐색</strong>을 돕는 서비스입니다.</li>
                <li>· 수치 데이터와 원자료는 KOSIS 국가통계포털에서 확인해 주세요.</li>
                <li>· 통계표를 연결해 해석할 때는 개편 이력을 먼저 확인하시기 바랍니다.</li>
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border bg-primary text-primary-foreground">
      <div className="pointer-events-none absolute inset-0 opacity-[0.07]" aria-hidden>
        <svg className="h-full w-full" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="800" height="400" fill="url(#grid)" />
        </svg>
      </div>
      <div className="container-page relative py-16 md:py-24">
        <p className="mb-3 text-sm font-semibold text-white/70">국가데이터처 승인통계 큐레이션</p>
        <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight md:text-5xl">{SITE_TAGLINE}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-white/80 md:text-base">
          어떤 통계가 있는지, 왜 만들어졌는지, 어떤 표를 봐야 하는지. 승인통계 조사와 KOSIS 통계표를
          한곳에서 찾아보세요.
        </p>
        <div className="mt-8 max-w-2xl rounded-xl bg-white p-2 shadow-lg">
          <SearchBox placeholder="예) 소비자물가, 경제활동인구, 인구총조사" />
        </div>
        <Suspense fallback={<Skeleton className="mt-6 h-5 w-64 bg-white/20" />}>
          <HeroStats />
        </Suspense>
      </div>
    </section>
  );
}

async function HeroStats() {
  const [stats, tables] = await Promise.all([getStatisticCount(), getTableCount()]);
  if (!stats && !tables) return null;
  return (
    <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-white/80">
      <div className="flex items-center gap-2">
        <Database className="size-4" aria-hidden />
        <dt>승인통계 조사</dt>
        <dd className="font-semibold text-white">{stats.toLocaleString("ko-KR")}개</dd>
      </div>
      <div className="flex items-center gap-2">
        <Table2 className="size-4" aria-hidden />
        <dt>KOSIS 통계표</dt>
        <dd className="font-semibold text-white">{tables.toLocaleString("ko-KR")}개</dd>
      </div>
    </dl>
  );
}

/* ------------------------------------------------------------------ */

async function CategorySection() {
  const res = await getCategorySummaries();
  if (res.error !== null) return <ErrorState compact detail={res.error} />;
  if (res.data.length === 0) {
    return <EmptyState compact title="등록된 분야가 없습니다" description="통계 데이터가 적재되면 분야가 자동으로 표시됩니다." />;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="list">
      {res.data.map(({ category, count }) => {
        const meta = getCategoryMeta(category);
        const Icon = meta.icon;
        return (
          <li key={category}>
            <Link
              href={`/browse?category=${encodeURIComponent(category)}`}
              className="group flex h-full items-center gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-[0_4px_16px_rgba(0,56,118,0.10)]"
            >
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold group-hover:text-primary">{meta.label}</span>
                <span className="block text-xs text-muted-foreground">{count}개 조사</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function CategoryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-[74px] rounded-xl" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

async function SetsSection() {
  const res = await getPublishedSets(3);
  if (res.error !== null) return <ErrorState compact detail={res.error} />;
  if (res.data.length === 0) {
    return (
      <EmptyState
        icon={BookMarked}
        compact
        title="큐레이션 세트를 준비하고 있습니다"
        description="주제별로 엮은 통계 묶음이 곧 공개됩니다. 그동안 분야별 찾기와 검색을 이용해 주세요."
        action={{ href: "/browse", label: "전체 조사 보기" }}
      />
    );
  }
  const counts = await getSetItemCounts(res.data.map((s) => s.id));
  return (
    <ul className="grid gap-4 md:grid-cols-3" role="list">
      {res.data.map((set, i) => (
        <li key={set.id} className={i === 0 ? "md:col-span-1" : ""}>
          <CuratedSetCard set={set} itemCount={counts.get(set.id)} featured={i === 0} />
        </li>
      ))}
    </ul>
  );
}

async function RecentSection() {
  const res = await getRecentStatistics(6);
  if (res.error !== null) return <ErrorState compact detail={res.error} />;
  if (res.data.length === 0) {
    return <EmptyState compact title="등록된 조사가 없습니다" description="통계 데이터가 적재되면 이곳에 표시됩니다." />;
  }
  return <StatisticGrid items={res.data} />;
}

async function NewsSection() {
  const res = await getRecentEvents(5);
  if (res.error !== null) return <ErrorState compact detail={res.error} />;
  if (res.data.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        compact
        title="아직 등록된 소식이 없습니다"
        description="통계 승인·개편·자료 갱신 이벤트가 등록되면 이곳에 시간순으로 표시됩니다."
      />
    );
  }
  return <Timeline items={res.data} showStatistic />;
}

function TimelineSkeleton() {
  return (
    <div className="space-y-6 border-l border-border pl-6" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
