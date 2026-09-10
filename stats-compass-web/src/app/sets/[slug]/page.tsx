import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookMarked, User } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { StatisticCard } from "@/components/statistics/statistic-card";
import { formatDate, truncate } from "@/lib/format";
import { pick } from "@/lib/normalize";
import { getSetBySlug, getSetItems } from "@/lib/queries/sets";

export const revalidate = 300;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const res = await getSetBySlug(decodeURIComponent(slug));
  if (res.error !== null || !res.data) return { title: "큐레이션 세트" };
  return { title: res.data.title, description: truncate(res.data.description ?? "", 150) };
}

export default async function SetDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const res = await getSetBySlug(decodeURIComponent(slug));
  if (res.error !== null) {
    return (
      <div className="container-page py-12">
        <ErrorState detail={res.error} />
      </div>
    );
  }
  if (!res.data) notFound();
  const set = res.data;
  const row = set as Record<string, unknown>;
  const items = await getSetItems(set.id);

  const theme = pick<string>(row, ["theme", "topic", "subtitle", "eyebrow"]);
  const editorNote = pick<string>(row, ["editor_note", "editors_note", "intro", "body", "content"]);
  const author = pick<string>(row, ["author", "editor", "curator"]);
  const date = set.published_at ?? set.updated_at ?? set.created_at ?? null;

  return (
    <>
      <div className="border-b border-border bg-gradient-to-b from-primary-soft/70 to-background">
        <div className="container-page py-8 md:py-12">
          <Breadcrumbs items={[{ href: "/sets", label: "큐레이션" }, { label: set.title }]} />
          <p className="mt-6 flex items-center gap-2 text-sm font-semibold text-primary">
            <BookMarked className="size-4" aria-hidden />
            {theme ?? "큐레이션 세트"}
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-4xl">{set.title}</h1>
          {set.description && <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">{set.description}</p>}
          <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {author && (
              <span className="inline-flex items-center gap-1">
                <User className="size-3.5" aria-hidden /> {author}
              </span>
            )}
            {date && <time dateTime={date}>{formatDate(date)}</time>}
            {items.error === null && <span>{items.data.length}개 통계</span>}
          </p>
        </div>
      </div>

      <div className="container-page py-10">
        {editorNote && editorNote !== set.description && (
          <div className="mb-10 rounded-xl border-l-4 border-primary bg-card p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <p className="text-sm font-semibold text-primary">편집자 노트</p>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-7">{editorNote}</p>
          </div>
        )}

        {items.error !== null ? (
          <ErrorState detail={items.error} />
        ) : items.data.length === 0 ? (
          <EmptyState title="아직 담긴 통계가 없습니다" description="이 세트는 편집 중입니다. 통계가 추가되면 이곳에 표시됩니다." />
        ) : (
          <ol className="space-y-4" role="list">
            {items.data.map(({ item, statistic }, i) => (
              <li key={item.id} className="grid gap-3 sm:grid-cols-[48px_1fr]">
                <span
                  className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                  aria-label={`${i + 1}번째`}
                >
                  {i + 1}
                </span>
                {statistic ? (
                  <StatisticCard statistic={statistic} note={pick<string>(item as Record<string, unknown>, ["editor_note", "note", "comment", "reason", "description"])} />
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                    연결된 통계 정보를 찾을 수 없습니다. (statistic_id: {item.statistic_id})
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
