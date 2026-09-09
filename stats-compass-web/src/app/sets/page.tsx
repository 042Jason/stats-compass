import type { Metadata } from "next";
import { BookMarked } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { CuratedSetCard } from "@/components/sets/curated-set-card";
import { getPublishedSets, getSetItemCounts } from "@/lib/queries/sets";

export const metadata: Metadata = {
  title: "큐레이션 세트",
  description: "편집자가 주제별로 골라 엮은 승인통계 묶음을 살펴보세요.",
};

export const revalidate = 300;

export default async function SetsPage() {
  const res = await getPublishedSets();
  const counts = res.error !== null ? new Map<string, number>() : await getSetItemCounts(res.data.map((s) => s.id));

  return (
    <>
      <PageHeader
        eyebrow="큐레이션"
        title="큐레이션 세트"
        description="하나의 질문이나 주제를 중심으로, 함께 보면 좋은 승인통계 조사를 편집자가 골라 엮었습니다. 처음 통계를 찾는 분도 어디서부터 볼지 감을 잡을 수 있도록 구성합니다."
      />
      <div className="container-page py-10">
        {res.error !== null ? (
          <ErrorState detail={res.error} />
        ) : res.data.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title="큐레이션 세트를 준비하고 있습니다"
            description="주제별 통계 묶음을 편집 중입니다. 공개되는 대로 이곳에서 안내해 드리겠습니다. 그동안 분야별 찾기와 검색을 이용해 주세요."
            action={{ href: "/browse", label: "전체 조사 보기" }}
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {res.data.map((set) => (
              <li key={set.id}>
                <CuratedSetCard set={set} itemCount={counts.get(set.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
