import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, User } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { ExternalDeepDiveCard } from "@/components/deep-dives/external-card";
import { formatDate, truncate } from "@/lib/format";
import { EXTERNAL_DEEP_DIVES } from "@/lib/external-deep-dives";
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
        description="한 조사를 골라 왜 만들어졌는지, 어떻게 조사하는지, 숫자를 읽을 때 무엇을 조심해야 하는지 차근차근 설명합니다. 밖에 따로 배포된 통계 대시보드도 함께 모았습니다."
      />
      <div className="container-page py-10">
        {res.error !== null && <ErrorState detail={res.error} />}

        {/* 외부 링크가 항상 한 칸을 차지하므로 목록이 통째로 비는 경우는 없습니다.
         * 아티클이 아직 없을 때만 아래에 편집 중이라는 한 줄을 답니다. */}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {EXTERNAL_DEEP_DIVES.map((x) => (
            <li key={x.key}>
              <ExternalDeepDiveCard item={x} />
            </li>
          ))}

          {res.error === null &&
            res.data.map((a) => {
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

        {res.error === null && res.data.length === 0 && (
          <p className="mt-6 rounded-xl border border-dashed border-border px-5 py-4 text-sm text-muted-foreground">
            직접 쓴 Deep Dive 아티클은 편집 중입니다. 공개되면 홈과 각 조사 상세 페이지에서도
            안내해 드리겠습니다.{" "}
            <Link href="/browse" className="font-semibold text-primary hover:underline">
              조사 둘러보기
            </Link>
          </p>
        )}
      </div>
    </>
  );
}
