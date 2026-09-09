import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { GraphExplorer } from "@/components/graph/graph-explorer";
import { getOntologySnapshot } from "@/lib/queries/ontology";

export const metadata: Metadata = {
  title: "관계망",
  description:
    "국가승인통계 조사와 통계개념·작성기관·주제분야를 온톨로지로 연결해 탐색합니다. DCAT·SKOS·SDMX 어휘에 매핑했습니다.",
};

export const revalidate = 300;

export default async function GraphPage() {
  const res = await getOntologySnapshot();

  return (
    <>
      <PageHeader
        eyebrow="온톨로지"
        title="통계 관계망"
        description="조사를 낱개로 보지 않고, 어떤 개념을 공유하는지·어떤 통계와 헷갈리는지·누가 만드는지를 이어서 봅니다. 클래스와 관계는 DCAT 3·SKOS·RDF Data Cube(SDMX) 어휘에 매핑해 두었습니다."
      />
      <div className="container-page py-10">
        {res.error !== null ? (
          <ErrorState detail={res.error} />
        ) : res.data.nodes.length === 0 ? (
          <EmptyState
            title="아직 관계망이 없습니다"
            description="온톨로지 시드를 먼저 실행해야 합니다. (supabase/0004_ontology.sql → src/seed/12_buildOntology.ts)"
          />
        ) : (
          <GraphExplorer snapshot={res.data} />
        )}
      </div>
    </>
  );
}
