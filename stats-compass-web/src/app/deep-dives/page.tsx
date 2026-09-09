import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, User } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { formatDate, truncate } from "@/lib/format";
import { getPublishedArticles } from "@/lib/queries/articles";

export const metadata: Metadata = {
  title: "Deep Dive",
  description: "승인통계 한 편을 깊이 들여다보는 심층 소개 아티클입니다.",
};

export const revalidate = 300;

export default async function DeepDivesPage() {
  const res = await getPublishedArticles();

  return (
    <>
      <PageHeader
        eyebrow="Deep Dive"
        title="심층 소개 아티클"
        description="한 조사를 골라 왜 만들어졌는지, 어떻게 조사하는지, 숫자를 읽을 때 무엇을 조심해야 하는지 차근차근 설명합니다."
      />
      <div className="container-page py-10">
        {res.error !== null ? (
          <ErrorState detail={res.error} />
        ) : res.data.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="첫 번째 아티클을 준비하고 있습니다"
            description="Deep Dive 아티클은 편집 중입니다. 공개되면 홈과 각 조사 상세 페이지에서도 안내해 드리겠습니다."
            action={{ href: "/browse", label: "조사 둘러보기" }}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {res.data.map((a) => {
              const date = a.published_at ?? a.created_at ?? null;
              return (
                <li key={a.id}>
                  <Link
                    href={`/deep-dives/${encodeURIComponent(a.slug)}`}
                    className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 transition hover:border-primary/40 hover:shadow-[0_4px_16px_rgba(0,56,118,0.10)]"
                  >
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <BookOpen className="size-3.5" aria-hidden /> Deep Dive
                    </p>
                    <h2 className="text-lg font-bold leading-snug group-hover:text-primary">{a.title}</h2>
                    {(a.subtitle ?? a.summary) && (
                      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{truncate(a.subtitle ?? a.summary, 140)}</p>
                    )}
                    <p className="mt-auto flex items-center gap-3 pt-2 text-xs text-muted-foreground">
                      {a.author && (
                        <span className="inline-flex items-center gap-1">
                          <User className="size-3.5" aria-hidden /> {a.author}
                        </span>
                      )}
                      {date && <time dateTime={date}>{formatDate(date, "short")}</time>}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
