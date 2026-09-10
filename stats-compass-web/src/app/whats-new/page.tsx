import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Timeline } from "@/components/events/timeline";
import { getRecentEvents } from "@/lib/queries/events";

export const metadata: Metadata = {
  title: "What's New",
  description: "승인통계의 신규 승인, 개편, 자료 갱신 소식을 시간순으로 안내합니다.",
};

export const revalidate = 300;

function yearOf(date: string | null): string {
  if (!date) return "날짜 미상";
  const m = date.match(/^(\d{4})/);
  return m ? `${m[1]}년` : "날짜 미상";
}

export default async function WhatsNewPage() {
  const res = await getRecentEvents(200);

  return (
    <>
      <PageHeader
        eyebrow="소식"
        title="What's New"
        description="새로 승인된 통계, 개편·명칭 변경, 통계표 추가와 자료 갱신 소식을 시간순으로 정리합니다. 통계표를 연결해 해석할 때 참고할 개편 시점도 여기서 확인할 수 있습니다."
      />
      <div className="container-page max-w-3xl py-10">
        {res.error !== null ? (
          <ErrorState detail={res.error} />
        ) : res.data.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="아직 등록된 소식이 없습니다"
            description="통계 승인·개편·자료 갱신 이벤트가 등록되면 이곳에 시간순으로 표시됩니다."
            action={{ href: "/browse", label: "통계 찾기" }}
          />
        ) : (
          <div className="space-y-12">
            {groupByYear(res.data).map(([year, items]) => (
              <section key={year} aria-labelledby={`y-${year}`}>
                <h2 id={`y-${year}`} className="mb-5 text-lg font-bold text-primary">
                  {year}
                </h2>
                <div className="rounded-xl border border-border bg-card p-5 md:p-6">
                  <Timeline items={items} showStatistic />
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function groupByYear<T extends { date: string | null }>(items: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = yearOf(it.date);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return [...map.entries()];
}
