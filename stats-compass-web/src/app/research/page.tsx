import type { Metadata } from "next";
import { Suspense } from "react";
import { Compass } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { ResearchForm } from "@/components/research/research-form";
import { RagResults } from "@/components/research/rag-results";
import { getLifeStages, getSampleQuestions, searchGraphRag } from "@/lib/queries/graphrag";
import { hasAnySlot, type ResolvedSlots } from "@/lib/slots";

export const metadata: Metadata = {
  title: "생애나침반",
  description:
    "생애주기 연구자가 던진 질문을 온톨로지 그래프로 풀어, 참고할 국가승인통계와 통계표를 근거와 함께 찾아 줍니다.",
};

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ q?: string; stage?: string }>;
}

export default async function ResearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const stages = (sp.stage ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [stageRows, samples] = await Promise.all([getLifeStages(), getSampleQuestions()]);
  const outcome = q ? await searchGraphRag(q, stages) : null;

  return (
    <>
      <PageHeader
        eyebrow="생애나침반"
        title="질문으로 통계 찾기"
        description="조사 이름을 몰라도 됩니다. 알고 싶은 것을 그대로 물어보면, 온톨로지를 타고 참고할 조사와 통계표를 찾아 왜 그것인지까지 보여 줍니다."
      />
      <div className="container-page space-y-10 py-10">
        <Suspense fallback={<div className="h-32" />}>
          <ResearchForm
            stages={stageRows}
            samples={samples}
            initialQuery={q}
            initialStages={stages}
          />
        </Suspense>

        {outcome && hasAnySlot(outcome.slots) && <SlotChips slots={outcome.slots} />}

        {stageRows.length > 0 && (
          <StageTimeline
            stages={stageRows}
            active={stages.length > 0 ? stages : (outcome?.slots.stages.map((s) => s.key) ?? [])}
          />
        )}

        {!q && (
          <EmptyState
            icon={Compass}
            title="무엇을 알고 싶으신가요?"
            description="위에 질문을 적거나 예시 질문을 눌러 보세요. 생애단계로 범위를 좁힐 수도 있습니다."
          />
        )}

        {outcome?.error && (
          <ErrorState
            title="검색하지 못했습니다"
            detail={outcome.error}
          />
        )}

        {outcome?.error === null && outcome.data.surveys.length === 0 && (
          <EmptyState
            title="맞는 통계를 찾지 못했습니다"
            description="질문을 조금 더 구체적으로 바꾸거나, 생애단계 선택을 풀어 보세요."
          />
        )}

        {outcome?.error === null && outcome.data.surveys.length > 0 && (
          <RagResults
            result={outcome.data}
            news={outcome.news}
            slots={outcome.slots}
            question={q}
          />
        )}
      </div>
    </>
  );
}

/**
 * 질문에서 뽑아낸 슬롯. "35살 대전 남자" 를 무엇으로 알아들었는지 보여 줍니다.
 *
 * 콤보박스를 두지 않은 대신 이 줄이 그 역할을 합니다. 잘못 알아들었으면
 * 사용자가 바로 알아채고 질문을 고칠 수 있습니다.
 */
function SlotChips({ slots }: { slots: ResolvedSlots }) {
  const items: Array<{ k: string; v: string; note?: string }> = [];
  if (slots.age !== null) {
    items.push({
      k: "나이",
      v: `${slots.age}세`,
      note: slots.ageText ? `"${slots.ageText}" 에서` : undefined,
    });
    if (slots.ageBands.length > 0) items.push({ k: "연령대", v: slots.ageBands.slice(0, 2).join(", ") });
  }
  if (slots.sex) items.push({ k: "성별", v: slots.sex, note: slots.sexText ? `"${slots.sexText}" 에서` : undefined });
  for (const r of slots.regions.slice(0, 2)) {
    items.push({ k: "지역", v: `${r.label} (${r.code})`, note: r.matched ? `"${r.matched}" 에서` : undefined });
  }
  if (slots.stages.length > 0) {
    items.push({ k: "생애단계", v: slots.stages.map((s) => s.label).join(" · ") });
  }

  return (
    <section aria-labelledby="slots" className="rounded-xl border border-border bg-card p-4">
      <h2 id="slots" className="text-sm font-semibold text-muted-foreground">
        질문에서 알아들은 것
      </h2>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {items.map((it, i) => (
          <div key={i} className="text-sm">
            <dt className="inline text-muted-foreground">{it.k} </dt>
            <dd className="inline font-semibold">{it.v}</dd>
            {it.note && <span className="ml-1 text-xs text-muted-foreground/80">{it.note}</span>}
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 생애단계 타임라인. 선택한 단계를 강조해 지금 어디를 보고 있는지 알려 줍니다. */
function StageTimeline({
  stages,
  active,
}: {
  stages: Array<{ key: string; label: string; description: string | null }>;
  active: string[];
}) {
  const on = new Set(active);
  return (
    <section aria-labelledby="timeline" className="overflow-x-auto">
      <h2 id="timeline" className="sr-only">
        생애단계 타임라인
      </h2>
      <ol className="flex min-w-max items-stretch gap-1">
        {stages.map((s, i) => {
          const highlight = on.size === 0 || on.has(s.key);
          return (
            <li
              key={s.key}
              className={[
                "relative flex-1 rounded-lg border px-3 py-2.5 transition-colors",
                highlight ? "border-primary/30 bg-primary-soft/40" : "border-border bg-card opacity-45",
              ].join(" ")}
              style={{ minWidth: 118 }}
            >
              <span className="block text-[10px] tabular-nums text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="block text-sm font-semibold">{s.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
