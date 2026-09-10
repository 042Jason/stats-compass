import Link from "next/link";
import { AlertTriangle, ArrowRight, Newspaper } from "lucide-react";
import type { RagResult } from "@/lib/graphrag";
import type { NewsItem } from "@/lib/queries/graphrag";
import type { ResolvedSlots } from "@/lib/slots";
import { GraphView } from "./graph-view";
import { TablesPanel } from "./tables-panel";
import { AiBriefing } from "./ai-briefing";

/** 관계 id → 사람이 읽는 말. 근거 경로를 문장으로 보여 주기 위한 표입니다. */
const VIA_LABEL: Record<string, string> = {
  answeredBy: "이 질문에 답할 수 있는 조사라서",
  measuredBy: "이 지표를 산출하는 조사라서",
  definesConcept: "이 용어를 정의하는 조사라서",
  usesIndicator: "이 지표를 쓰는 질문이라서",
  hasDistribution: "이 통계표를 제공하는 조사라서",
  sharesConceptWith: "같은 개념을 쓰는 조사라서",
  oftenConfusedWith: "함께 놓고 봐야 하는 조사라서",
  complements: "같은 묶음으로 큐레이션된 조사라서",
  relatedTo: "주제어가 겹치는 조사라서",
  hasKeyword: "이 주제어가 붙은 조사라서",
  hasTheme: "이 주제분야에 속해서",
  coversLifeStage: "이 생애단계를 다루는 조사라서",
};

const CLASS_LABEL: Record<string, string> = {
  Survey: "조사",
  Concept: "용어",
  Indicator: "지표",
  ResearchQuestion: "연구질문",
  Keyword: "주제어",
  Theme: "주제분야",
  LifeStage: "생애단계",
  StatisticalTable: "통계표",
};

export function RagResults({
  result,
  news,
  slots,
  question,
}: {
  result: RagResult;
  news: NewsItem[];
  slots: ResolvedSlots;
  question: string;
}) {
  const max = result.surveys[0]?.score ?? 1;

  return (
    <div className="space-y-10">
      {/* 맨 위에 둡니다. 결과 목록을 먼저 보면 "어디서 나온 건지" 를 모른 채 읽게 됩니다.
       * 경로를 먼저 보여 주고, 그 다음에 그 경로가 찾아낸 것들을 늘어놓는 순서입니다. */}
      <GraphView result={result} slots={slots} />

      {/* 경로를 본 다음 "그래서 어떻게 보면 되는가". 검색과 따로 부르므로
       * 이 칸이 로딩 중이어도 아래 결과 목록은 이미 다 떠 있습니다. */}
      <AiBriefing
        key={`${question}|${result.tables.map((t) => t.tblId ?? "").join(",")}`}
        question={question}
        slots={slots}
        result={result}
      />

      {/* 검색 진입점 — GraphRAG 의 1단계를 그대로 보여 줍니다 */}
      {result.seeds.length > 0 && (
        <section aria-labelledby="seeds">
          <h2 id="seeds" className="text-sm font-semibold text-muted-foreground">
            질문과 가까운 노드 (벡터 + 어휘 하이브리드)
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {result.seeds.slice(0, 8).map((s, i) => (
              <span
                key={`${s.label}-${i}`}
                className="rounded-md border border-border bg-card px-2.5 py-1 text-xs"
              >
                <span className="text-muted-foreground">{CLASS_LABEL[s.class] ?? s.class}</span>{" "}
                {s.label}
                <span className="ml-1.5 tabular-nums text-muted-foreground">
                  {s.sim.toFixed(2)}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 추천 조사 */}
      <section aria-labelledby="surveys">
        <h2 id="surveys" className="text-lg font-bold">
          참고할 통계조사
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          검색으로 찾은 노드에서 관계를 타고 도달한 조사입니다. 왜 나왔는지 경로를 함께 보여 줍니다.
        </p>
        <ul className="mt-4 space-y-4">
          {result.surveys.map((s) => (
            <li key={s.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-bold">
                  {s.statId ? (
                    <Link
                      href={`/statistics/${encodeURIComponent(s.statId)}`}
                      className="hover:text-primary hover:underline"
                    >
                      {s.label}
                    </Link>
                  ) : (
                    s.label
                  )}
                </h3>
                <span className="text-xs tabular-nums text-muted-foreground">
                  관련도 {s.score.toFixed(3)}
                </span>
              </div>

              <div
                className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`관련도 ${s.score.toFixed(3)}`}
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(6, Math.round((s.score / max) * 100))}%` }}
                />
              </div>

              {s.overview && (
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-foreground/80">
                  {s.overview}
                </p>
              )}

              {s.paths.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-3">
                  {s.paths.map((p, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {CLASS_LABEL[p.fromClass] ?? p.fromClass}
                      </span>
                      <span className="font-medium">{p.from}</span>
                      <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
                      <span className="text-muted-foreground">
                        {p.via ? (VIA_LABEL[p.via] ?? p.via) : "질문과 직접 가까워서"}
                      </span>
                      <span className="tabular-nums text-muted-foreground/70">
                        ({p.sim.toFixed(2)})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 헷갈리는 쌍 */}
      {result.cautions.length > 0 && (
        <section aria-labelledby="cautions">
          <h2 id="cautions" className="text-lg font-bold">
            섞어 쓰면 안 되는 조합
          </h2>
          <div className="mt-3 space-y-3">
            {result.cautions.map((c, i) => (
              <div
                key={i}
                className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4"
              >
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-amber-950">
                    {c.a} · {c.b}
                  </p>
                  {c.why && <p className="mt-1 text-sm leading-6 text-amber-950/90">{c.why}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 통계표 목록 + 수치 대시보드.
       *
       * 둘을 한 컴포넌트로 묶었습니다. 순서를 한 곳에서 쥐고 양쪽에 같은 배열을
       * 내려 줘야 목록 2번째 표가 수치에서도 2번째로 나옵니다.
       *
       * key 를 통계표 목록으로 잡습니다. 이게 없으면 새 질문을 던져도 React 가
       * 같은 자리의 컴포넌트를 재사용해서, 이전 질문에서 불러온 수치와 체크박스
       * 선택이 그대로 남습니다. */}
      <TablesPanel
        key={result.tables.map((t) => t.tblId ?? "").join(",")}
        question={question}
        tables={result.tables}
      />

      {/* 관련 보도자료 */}
      {news.length > 0 && (
        <section aria-labelledby="news">
          <h2 id="news" className="flex items-center gap-2 text-lg font-bold">
            <Newspaper className="size-5 text-primary" aria-hidden />
            관련 보도자료
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
            {news.map((a) => (
              <li key={a.url} className="p-4">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:text-primary hover:underline"
                >
                  {a.title}
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[a.publishedOn, a.department, a.survey].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
