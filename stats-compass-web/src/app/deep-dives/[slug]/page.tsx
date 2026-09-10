import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, User, ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { StatisticCard } from "@/components/statistics/statistic-card";
import { formatDate, truncate } from "@/lib/format";
import { pick, toTags } from "@/lib/normalize";
import { getArticleBySlug } from "@/lib/queries/articles";
import { getStatisticsByIds } from "@/lib/queries/statistics";
import { Badge } from "@/components/ui/badge";

export const revalidate = 300;

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const res = await getArticleBySlug(decodeURIComponent(slug));
  if (res.error !== null || !res.data) return { title: "Deep Dive" };
  return {
    title: res.data.title,
    description: truncate(res.data.summary ?? res.data.subtitle ?? "", 150),
    openGraph: { type: "article", title: res.data.title },
  };
}

export default async function DeepDivePage({ params }: { params: Params }) {
  const { slug } = await params;
  const res = await getArticleBySlug(decodeURIComponent(slug));
  if (res.error !== null) {
    return (
      <div className="container-page py-12">
        <ErrorState detail={res.error} />
      </div>
    );
  }
  if (!res.data) notFound();
  const a = res.data;
  const row = a as Record<string, unknown>;

  const body = pick<string>(row, ["body_markdown", "body", "content", "markdown", "text"]);
  const authorName = pick<string>(row, ["author_name", "author", "curator_name"]);
  const tags = toTags(pick(row, ["tags", "keywords"]) as string[] | null);
  const date = a.published_at ?? a.created_at ?? null;
  const readMin =
    pick<number>(row, ["reading_minutes"]) ??
    (body ? Math.max(1, Math.round(body.replace(/\s+/g, "").length / 500)) : null);

  const linked = a.statistic_id ? await getStatisticsByIds([a.statistic_id]) : null;
  const statistic = linked !== null && linked.error === null ? (linked.data[0] ?? null) : null;

  return (
    <article>
      <div className="border-b border-border bg-muted/40">
        <div className="container-page max-w-3xl py-8 md:py-12">
          <Breadcrumbs items={[{ href: "/deep-dives", label: "Deep Dive" }, { label: a.title }]} />
          <p className="mt-6 flex items-center gap-1.5 text-sm font-semibold text-primary">
            <BookOpen className="size-4" aria-hidden /> Deep Dive
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight md:text-4xl">{a.title}</h1>
          {a.subtitle && <p className="mt-3 text-lg leading-7 text-muted-foreground">{a.subtitle}</p>}
          <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {authorName && (
              <span className="inline-flex items-center gap-1">
                <User className="size-4" aria-hidden /> {authorName}
              </span>
            )}
            {date && <time dateTime={date}>{formatDate(date)}</time>}
            {readMin && <span>약 {readMin}분 읽기</span>}
          </p>
          {tags.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-1.5" role="list" aria-label="태그">
              {tags.map((t) => (
                <li key={t}>
                  <Badge variant="soft">#{t}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="container-page max-w-3xl py-10">
        {a.summary && a.summary !== a.subtitle && (
          <p className="mb-8 rounded-xl border-l-4 border-primary bg-primary-soft/60 p-5 text-[15px] leading-7">{a.summary}</p>
        )}

        {body ? (
          <div className="prose-gov">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        ) : (
          <EmptyState title="본문을 준비하고 있습니다" description="이 분석의 본문은 아직 작성 중입니다." />
        )}

        {statistic && (
          <section className="mt-12 border-t border-border pt-8" aria-labelledby="linked-stat">
            <h2 id="linked-stat" className="mb-4 text-lg font-bold">
              이 분석이 다루는 통계
            </h2>
            <StatisticCard statistic={statistic} />
          </section>
        )}

        <div className="mt-12 flex justify-between border-t border-border pt-6 text-sm">
          <Link href="/deep-dives" className="inline-flex items-center gap-1 text-primary hover:underline">
            분석 목록으로
          </Link>
          <Link href="/browse" className="inline-flex items-center gap-1 text-primary hover:underline">
            통계 찾기 <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}
