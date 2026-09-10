import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Building2,
  CalendarClock,
  Scale,
  Target,
  Hash,
  History,
  Bell,
  Table2,
  BookOpen,
  BadgeCheck,
  Phone,
  Lightbulb,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { SectionHeader } from "@/components/shared/section-header";
import { CategoryBadge } from "@/components/statistics/category-badge";
import { KosisLinkButton } from "@/components/statistics/kosis-link-button";
import { TableList } from "@/components/statistics/table-list";
import { StatisticGrid } from "@/components/statistics/statistic-grid";
import { Timeline } from "@/components/events/timeline";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, frequencyLabel, truncate } from "@/lib/format";
import { displayAgency } from "@/lib/agency";
import {
  kosisDate,
  metaDetailEntries,
  metaEntries,
  metaValue,
  parseExaminHistory,
  pick,
  toAiContent,
  toParagraphs,
  toTags,
} from "@/lib/normalize";
import {
  getEventsForStatistic,
  getHistoryForStatistic,
  getRelatedStatistics,
  getStatisticByStatId,
  getTablesForStatistic,
} from "@/lib/queries/statistics";
import { getArticlesForStatistic } from "@/lib/queries/articles";
import { SITE_NAME } from "@/lib/constants";

export const revalidate = 300;

type Params = Promise<{ stat_id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { stat_id } = await params;
  const res = await getStatisticByStatId(decodeURIComponent(stat_id));
  if (res.error !== null || !res.data) return { title: "통계 상세" };
  const s = res.data;
  return {
    title: s.name_ko,
    description: truncate(s.purpose ?? s.description ?? `${s.name_ko} 승인통계 안내`, 150),
    openGraph: { title: `${s.name_ko} | ${SITE_NAME}`, description: truncate(s.purpose ?? "", 150) },
  };
}

export default async function StatisticDetailPage({ params }: { params: Params }) {
  const { stat_id } = await params;
  const statId = decodeURIComponent(stat_id);
  const res = await getStatisticByStatId(statId);

  if (res.error !== null) {
    return (
      <div className="container-page py-12">
        <ErrorState detail={res.error} />
      </div>
    );
  }
  if (!res.data) notFound();
  const s = res.data;

  const [tables, history, events, related, articles] = await Promise.all([
    getTablesForStatistic(s.id),
    getHistoryForStatistic(s.id),
    getEventsForStatistic(s.id),
    getRelatedStatistics(s.category, s.id, 3),
    getArticlesForStatistic(s.id, 3),
  ]);

  const row = s as Record<string, unknown>;
  const raw = s.raw_meta;
  const agency = displayAgency(s.agency);
  const tags = toTags(s.tags);
  const freq = frequencyLabel(s.frequency);
  const description = s.description ?? pick<string>(row, ["summary", "overview", "intro"]);
  const kosisUrl = pick<string>(row, ["kosis_url", "url", "homepage", "website"]);
  const representative = tables.error === null ? tables.data.find((t) => t.is_representative) : undefined;
  const extra = metaEntries(raw, 10);

  // 전용 컬럼이 비어 있으면 KOSIS 통계설명자료(raw_meta)에서 보충합니다.
  const purpose = s.purpose ?? metaValue(raw, ["PRP_CNT", "writingPurps"]);
  const legalBasis = s.legal_basis ?? metaValue(raw, ["LAWFUL_BAS", "basisLaw"]);
  const target =
    pick<string>(row, ["survey_target", "target", "coverage", "scope"]) ??
    metaValue(raw, ["STATS_TARGET", "examinObjrange"]);
  const method =
    pick<string>(row, ["survey_method", "method", "stat_type", "collection_method"]) ??
    metaValue(raw, ["RESN_TXT", "dataCollectMth"]);

  // 연혁: statistic_history 테이블이 비어 있으면 raw_meta.examinHistory 를 파싱해 사용
  const dbHistory = history.error === null ? history.data : [];
  const historyText = metaValue(raw, ["examinHistory"]);
  const metaHistory = dbHistory.length > 0 ? [] : parseExaminHistory(historyText);
  const historyItems = dbHistory.length > 0 ? dbHistory : metaHistory;
  // 타임라인으로 쪼개지지 않는 연혁은 줄글로 보여줍니다.
  const historyProse = historyItems.length === 0 ? toParagraphs(historyText) : [];
  const fromMeta = dbHistory.length === 0 && (metaHistory.length > 0 || historyProse.length > 0);

  // AI 정제본이 있으면 그것을 우선 보여주고, 원문은 접어서 함께 둡니다.
  const ai = toAiContent(s.ai_content);
  const terms = toParagraphs(metaValue(raw, ["mainTermExpl"]));
  const userNotes = toParagraphs(metaValue(raw, ["dataUserNote", "totData"]));
  const design = metaDetailEntries(raw, 24);

  const startYear =
    pick<string | number>(row, ["start_year", "first_year", "started_at", "since"]) ??
    historyItems.map((h) => h.date).filter(Boolean).sort()[0] ??
    null;
  // approval_date 컬럼이 있으면 우선, 없으면 KOSIS 메타의 confmDt(YYYYMMDD)
  const approvedOn = pick<string>(row, ["approval_date"]) ?? kosisDate(metaValue(raw, ["confmDt"]));

  const facts: Array<{ icon: typeof Building2; label: string; value: string | null }> = [
    { icon: Building2, label: "작성기관", value: agency },
    { icon: CalendarClock, label: "작성주기", value: freq || null },
    { icon: Hash, label: "통계 ID", value: s.stat_id },
    { icon: Target, label: "조사대상", value: target },
    { icon: BookOpen, label: "작성방법", value: method },
    { icon: History, label: "최초작성", value: startYear === null ? null : String(startYear) },
    { icon: BadgeCheck, label: "승인번호", value: metaValue(raw, ["confmNo"]) },
    { icon: BadgeCheck, label: "승인일", value: approvedOn ? formatDate(approvedOn) : null },
    { icon: Phone, label: "문의처", value: displayAgency(metaValue(raw, ["writingTel"])) },
  ];

  const tableCount = tables.error !== null ? 0 : tables.data.length;
  const historyCount = historyItems.length || (historyProse.length > 0 ? 1 : 0);
  const eventCount = events.error !== null ? 0 : events.data.length;

  return (
    <>
      {/* 머리글 */}
      <div className="border-b border-border bg-muted/40">
        <div className="container-page py-8 md:py-10">
          <Breadcrumbs
            items={[
              { href: "/browse", label: "통계 찾기" },
              ...(s.category ? [{ href: `/browse?category=${encodeURIComponent(s.category)}`, label: s.category }] : []),
              { label: s.name_ko },
            ]}
          />
          <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CategoryBadge category={s.category} linked size="md" />
                {s.status && <Badge variant="outline">{s.status}</Badge>}
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight md:text-3xl">{s.name_ko}</h1>
              {s.name_en && <p className="mt-1 text-sm text-muted-foreground">{s.name_en}</p>}
              {agency && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Building2 className="size-4" aria-hidden />
                  {agency}
                  {freq && <span aria-hidden> · </span>}
                  {freq && <span>{freq} 작성</span>}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <KosisLinkButton href={representative?.kosis_url ?? kosisUrl} fallbackQuery={s.name_ko} />
            </div>
          </div>
        </div>
      </div>

      <div className="container-page grid gap-10 py-10 lg:grid-cols-[1fr_300px]">
        {/* 본문 */}
        <div className="min-w-0 space-y-12">
          {/* 개요 */}
          <section aria-labelledby="overview">
            <SectionHeader id="overview" title="통계 개요" />
            <div className="space-y-6">
              {ai.overview && (
                <div className="rounded-xl border border-primary/20 bg-primary-soft/40 p-5">
                  <p className="text-[15px] leading-7">{ai.overview}</p>
                  {ai.sources.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      참고:{" "}
                      {ai.sources.map((src, i) => (
                        <span key={src.url}>
                          {i > 0 && " · "}
                          <a href={src.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">
                            {src.title}
                          </a>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}
              {(purpose || description) && (
                <div className="rounded-xl border border-border bg-card p-5">
                  {purpose && (
                    <div>
                      <h3 className="text-sm font-semibold text-primary">작성 목적</h3>
                      <p className="mt-1.5 text-[15px] leading-7">{purpose}</p>
                    </div>
                  )}
                  {description && description !== purpose && (
                    <div className={purpose ? "mt-5" : ""}>
                      <h3 className="text-sm font-semibold text-primary">설명</h3>
                      <p className="mt-1.5 text-[15px] leading-7">{description}</p>
                    </div>
                  )}
                </div>
              )}
              {legalBasis && (
                <div className="flex gap-3 rounded-xl border border-border bg-card p-5">
                  <Scale className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <h3 className="text-sm font-semibold text-primary">법적 근거</h3>
                    <p className="mt-1 text-[15px] leading-7">{legalBasis}</p>
                  </div>
                </div>
              )}
              {!purpose && !description && !legalBasis && (
                <EmptyState compact title="개요 정보가 아직 없습니다" description="작성 목적과 법적 근거는 메타정보 수집 후 표시됩니다." />
              )}
            </div>
          </section>

          {/* 통계표 / 연혁 / 소식 */}
          <section aria-labelledby="details">
            <SectionHeader id="details" title="통계표와 이력" description="KOSIS에 공개된 통계표, 조사 연혁, 최근 소식을 확인하세요." />
            <Tabs defaultValue="tables">
              <TabsList aria-label="상세 정보 구분">
                <TabsTrigger value="tables">
                  <Table2 className="size-4" aria-hidden /> 통계표 <span className="text-xs opacity-70">{tableCount}</span>
                </TabsTrigger>
                <TabsTrigger value="history">
                  <History className="size-4" aria-hidden /> 연혁 <span className="text-xs opacity-70">{historyCount}</span>
                </TabsTrigger>
                <TabsTrigger value="events">
                  <Bell className="size-4" aria-hidden /> 소식 <span className="text-xs opacity-70">{eventCount}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tables">
                {tables.error !== null ? <ErrorState compact detail={tables.error} /> : <TableList tables={tables.data} statName={s.name_ko} />}
              </TabsContent>

              <TabsContent value="history">
                {historyItems.length === 0 && historyProse.length === 0 ? (
                  <EmptyState icon={History} compact title="등록된 연혁이 없습니다" description="통계 개편·명칭 변경 등 연혁 정보가 수집되면 표시됩니다." />
                ) : (
                  <div className="rounded-xl border border-border bg-card p-5">
                    {fromMeta && (
                      <p className="mb-4 text-xs text-muted-foreground">
                        KOSIS 통계설명자료의 조사연혁을 정리한 내용입니다. 여기에 기재되지 않은 개편은 확인되지 않습니다.
                      </p>
                    )}
                    {historyItems.length > 0 ? (
                      <Timeline items={historyItems} />
                    ) : (
                      <div className="space-y-2 text-[15px] leading-7">
                        {historyProse.map((para, i) => (
                          <p key={i}>{para}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="events">
                {events.error !== null ? (
                  <ErrorState compact detail={events.error} />
                ) : events.data.length === 0 ? (
                  <EmptyState icon={Bell} compact title="최근 소식이 없습니다" description="이 통계와 관련된 승인·개편·자료 갱신 소식이 등록되면 표시됩니다." />
                ) : (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <Timeline items={events.data} />
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </section>

          {/* 주요 용어 */}
          {(ai.terms.length > 0 || terms.length > 0) && (
            <section aria-labelledby="terms">
              <SectionHeader id="terms" title="주요 용어" description="이 통계를 읽을 때 알아두면 좋은 개념" />
              {ai.terms.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full border-collapse text-left text-[15px]">
                    <caption className="sr-only">주요 용어와 설명</caption>
                    <thead className="bg-muted/60">
                      <tr>
                        <th scope="col" className="w-[30%] min-w-32 px-4 py-3 text-sm font-semibold text-primary">
                          용어
                        </th>
                        <th scope="col" className="px-4 py-3 text-sm font-semibold text-primary">
                          설명
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {ai.terms.map((t) => (
                        <tr key={t.term} className="align-top">
                          <th scope="row" className="px-4 py-3 font-medium">
                            {t.term}
                          </th>
                          <td className="px-4 py-3 leading-7">{t.plain}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-border bg-card p-5 text-[15px] leading-7">
                  {terms.map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              )}
              {ai.terms.length > 0 && terms.length > 0 && (
                <details className="mt-3 rounded-xl border border-border bg-card">
                  <summary className="cursor-pointer list-none p-4 text-sm text-muted-foreground hover:text-foreground">
                    KOSIS 원문 용어 설명 보기
                  </summary>
                  <div className="space-y-3 border-t border-border p-5 text-sm leading-7 text-muted-foreground">
                    {terms.map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                </details>
              )}
            </section>
          )}

          {/* 이용자 유의사항 */}
          {(ai.cautions.length > 0 || userNotes.length > 0) && (
            <section aria-labelledby="notes">
              <SectionHeader id="notes" title="이용 시 유의사항" description="수치를 해석하기 전에 확인해야 할 내용" />
              <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-5">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
                {ai.cautions.length > 0 ? (
                  <ul className="list-disc space-y-2 pl-5 text-[15px] leading-7 text-amber-950" role="list">
                    {ai.cautions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-2 text-[15px] leading-7 text-amber-950">
                    {userNotes.map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                )}
              </div>
              {ai.cautions.length > 0 && userNotes.length > 0 && (
                <details className="mt-3 rounded-xl border border-border bg-card">
                  <summary className="cursor-pointer list-none p-4 text-sm text-muted-foreground hover:text-foreground">
                    KOSIS 원문 유의사항 보기
                  </summary>
                  <div className="space-y-2 border-t border-border p-5 text-sm leading-7 text-muted-foreground">
                    {userNotes.map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                </details>
              )}
            </section>
          )}

          {/* 조사 설계 */}
          {design.length > 0 && (
            <section aria-labelledby="design">
              <SectionHeader id="design" title="조사 설계" description="조사 항목·기간·표본 등 작성 방법 상세" />
              <details className="group rounded-xl border border-border bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-2 p-5 text-sm font-semibold text-primary">
                  <ClipboardList className="size-4" aria-hidden />
                  항목 {design.length}개 펼쳐 보기
                </summary>
                <dl className="space-y-4 border-t border-border p-5 text-sm">
                  {design.map(([label, value]) => (
                    <div key={label} className="grid gap-1 sm:grid-cols-[128px_1fr] sm:gap-4">
                      <dt className="font-medium text-muted-foreground">{label}</dt>
                      <dd className="leading-7">{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </section>
          )}

          {/* Deep Dive */}
          {articles.length > 0 && (
            <section aria-labelledby="dd">
              <SectionHeader id="dd" title="Deep Dive" description="이 통계를 깊이 소개하는 분석" />
              <ul className="grid gap-4 sm:grid-cols-2" role="list">
                {articles.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/deep-dives/${encodeURIComponent(a.slug)}`}
                      className="block h-full rounded-xl border border-border bg-card p-5 transition hover:border-primary/40 hover:shadow-[0_4px_16px_rgba(0,56,118,0.10)]"
                    >
                      <p className="font-semibold hover:text-primary">{a.title}</p>
                      {(a.subtitle ?? a.summary) && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.subtitle ?? a.summary}</p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 관련 조사 */}
          {related.length > 0 && (
            <section aria-labelledby="related">
              <SectionHeader
                id="related"
                title="같은 분야의 다른 통계"
                moreHref={s.category ? `/browse?category=${encodeURIComponent(s.category)}` : "/browse"}
              />
              <StatisticGrid items={related} compact />
            </section>
          )}
        </div>

        {/* 사이드바 */}
        <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-primary">기본 정보</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {facts
                .filter((f) => f.value)
                .map((f) => {
                  const Icon = f.icon;
                  return (
                    <div key={f.label} className="flex gap-2.5">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{f.label}</dt>
                        <dd className="break-words font-medium">{f.value}</dd>
                      </div>
                    </div>
                  );
                })}
            </dl>
          </div>

          {tags.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-primary">태그</h2>
              <ul className="mt-3 flex flex-wrap gap-1.5" role="list">
                {tags.map((t) => (
                  <li key={t}>
                    <Link href={`/search?q=${encodeURIComponent(t)}`}>
                      <Badge variant="secondary" className="font-normal hover:bg-primary-soft hover:text-primary">
                        #{t}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {extra.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                <Lightbulb className="size-4" aria-hidden />
                KOSIS 통계설명자료
              </h2>
              <dl className="mt-3 space-y-2 text-sm">
                {extra.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[88px_1fr] gap-2">
                    <dt className="truncate text-xs text-muted-foreground" title={k}>
                      {k}
                    </dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div className="rounded-xl bg-primary-soft p-5 text-sm leading-6 text-primary">
            <p className="font-semibold">읽을 때 참고하세요</p>
            <p className="mt-1 text-primary/80">
              통계표마다 작성 기준과 개편 시점이 다를 수 있습니다. 여러 표를 이어 해석하기 전에 연혁 탭의 개편 이력을 확인해
              주세요.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
