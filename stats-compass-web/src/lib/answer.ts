import "server-only";
import type { RagResult } from "@/lib/graphrag";
import type { ResolvedSlots } from "@/lib/slots";

/**
 * 검색 결과를 컨텍스트로 삼아 LLM 이 <길잡이>를 씁니다.
 *
 * ── 왜 수치를 안 넘기는가
 * 이 층은 숫자를 말하지 않습니다. 컨텍스트에 통계표 <이름>만 넣고 값은 넣지 않습니다.
 * 수치는 KOSIS 카드가 원본 그대로 보여 주고, LLM 은 "왜 이 조사인지, 어떤 순서로
 * 보면 되는지, 무엇을 조심해야 하는지" 만 씁니다.
 *
 * 통계는 숫자 하나가 틀리면 그 답변 전체를 못 믿게 됩니다. 반대로 "가계금융복지조사는
 * 표본조사라 시도별 값은 오차가 큽니다" 같은 안내는 틀릴 여지가 훨씬 적고, 연구자가
 * 실제로 막히는 지점이기도 합니다. 그래서 역할을 이렇게 갈랐습니다.
 *
 * ── 컨텍스트에 들어가는 것
 * 전부 검색이 실제로 찾아낸 것뿐입니다. 모델이 아는 통계 지식을 끌어다 쓰지 못하도록
 * 프롬프트에서 막습니다. 목록에 없는 조사명을 말하면 그건 환각입니다.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
/** 바뀔 수 있으니 환경변수로 덮어쓸 수 있게 둡니다. */
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const SYSTEM = `당신은 국가승인통계 길잡이입니다. 연구자가 어느 통계를 어떤 순서로 봐야 하는지 안내합니다.

지켜야 할 것:
- 아래 <검색결과>에 있는 조사·용어·통계표만 언급합니다. 목록에 없는 조사명을 지어내지 마세요.
- 구체적인 수치(금액·비율·인원)를 말하지 마세요. 숫자는 화면의 KOSIS 카드가 보여 줍니다.
  "평균 소득은 얼마입니다" 같은 문장을 쓰면 안 됩니다. 대신 "어느 표에서 확인할 수 있습니다" 라고 쓰세요.
- 확실하지 않으면 단정하지 말고 무엇을 더 확인해야 하는지 적으세요.
- 담백하게 씁니다. 감탄사·상투어를 쓰지 않습니다.

형식:
1) 첫 문단 — 질문을 어떻게 이해했는지, 어느 조사부터 보면 되는지 두세 문장.
2) **먼저 볼 것** — 조사 2~3개를 불릿으로. 각 줄에 그 조사를 보는 이유 한 줄.
3) **조심할 점** — 혼동쌍·표본오차·지역단위·시계열단절 중 해당하는 것만. 없으면 이 절을 빼세요.

전체 400자 안팎. 마크다운을 씁니다.`;

function clip(s: string | null | undefined, n: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

/** 관계 id → 사람 말. 경로를 문장으로 풀어 주면 모델이 이유를 정확히 옮깁니다. */
const VIA: Record<string, string> = {
  answeredBy: "이 연구질문에 답하는 조사",
  measuredBy: "이 지표를 산출하는 조사",
  definesConcept: "이 용어를 정의하는 조사",
  usesIndicator: "이 지표를 쓰는 질문",
  hasDistribution: "이 통계표를 제공",
  sharesConceptWith: "같은 개념을 쓰는 조사",
  oftenConfusedWith: "함께 놓고 봐야 하는 조사",
  complements: "같은 묶음으로 큐레이션",
  relatedTo: "주제어가 겹침",
  hasKeyword: "이 주제어가 붙음",
  coversLifeStage: "이 생애단계를 다룸",
  hasTheme: "이 주제분야에 속함",
};

export function buildContext(question: string, slots: ResolvedSlots, r: RagResult): string {
  const lines: string[] = [];

  lines.push(`<질문>\n${question}\n</질문>`);

  const slotBits: string[] = [];
  if (slots.age !== null) slotBits.push(`나이 ${slots.age}세`);
  if (slots.ageBands.length > 0) slotBits.push(`연령대 ${slots.ageBands.slice(0, 2).join(", ")}`);
  if (slots.sex) slotBits.push(`성별 ${slots.sex}`);
  for (const g of slots.regions.slice(0, 2)) slotBits.push(`지역 ${g.label}`);
  if (slots.stages.length > 0) slotBits.push(`생애단계 ${slots.stages.map((s) => s.label).join("·")}`);
  if (slotBits.length > 0) lines.push(`<질문에서 읽어낸 것>\n${slotBits.join(" / ")}\n</질문에서 읽어낸 것>`);

  lines.push("<검색결과>");

  lines.push("[찾아낸 조사 — 점수 높은 순]");
  for (const s of r.surveys.slice(0, 8)) {
    const why = s.paths
      .slice(0, 3)
      .map((p) => `${p.from}${p.via ? `(${VIA[p.via] ?? p.via})` : "(질문과 직접 가까움)"}`)
      .join(", ");
    lines.push(`- ${s.label}`);
    if (s.overview) lines.push(`    개요: ${clip(s.overview, 160)}`);
    if (why) lines.push(`    도달 경로: ${why}`);
  }

  if (r.concepts.length > 0) {
    lines.push("");
    lines.push("[조사들이 공유하는 통계용어]");
    for (const c of r.concepts.slice(0, 8)) {
      const shared = c.surveys.length > 1 ? ` (${c.surveys.join(", ")} 가 함께 정의)` : "";
      lines.push(`- ${c.label}${shared}${c.definition ? ` — ${clip(c.definition, 90)}` : ""}`);
    }
  }

  if (r.cautions.length > 0) {
    lines.push("");
    lines.push("[섞어 쓰면 안 되는 조합 — 조사 설명자료의 이용시 유의사항에서 뽑은 것]");
    for (const c of r.cautions.slice(0, 5)) {
      lines.push(`- ${c.a} ↔ ${c.b}${c.why ? `: ${clip(c.why, 140)}` : ""}`);
    }
  }

  if (r.dropped.length > 0) {
    lines.push("");
    lines.push("[후보였다가 점수에서 밀린 조사]");
    lines.push(r.dropped.slice(0, 5).map((d) => d.label).join(", "));
  }

  if (r.tables.length > 0) {
    lines.push("");
    lines.push("[넘길 통계표 — 이름만. 값은 화면의 KOSIS 카드가 보여 줍니다]");
    for (const t of r.tables.slice(0, 10)) {
      const span = [t.firstPeriod, t.latestPeriod].filter(Boolean).join("~");
      lines.push(`- ${t.label} (${t.survey ?? "?"}${span ? `, ${span}` : ""})`);
    }
  }

  lines.push("</검색결과>");
  return lines.join("\n");
}

export type AnswerResult = { text: string; error: null } | { text: null; error: string };

export async function writeBriefing(
  question: string,
  slots: ResolvedSlots,
  result: RagResult,
): Promise<AnswerResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { text: null, error: "OPENAI_API_KEY 가 없습니다." };
  if (result.surveys.length === 0) return { text: null, error: "찾은 조사가 없어 길잡이를 쓸 수 없습니다." };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildContext(question, slots, result) },
        ],
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      // 모델명이 바뀌었을 때가 가장 흔합니다. 그 경우를 짚어 줍니다.
      const hint = res.status === 404 ? ` — OPENAI_MODEL 환경변수로 모델명을 바꿔 보세요 (현재 ${MODEL})` : "";
      return { text: null, error: `LLM 호출 실패 (${res.status})${hint} ${detail}` };
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return { text: null, error: "LLM 응답이 비어 있습니다." };
    return { text, error: null };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { text: null, error: m.includes("timeout") ? "LLM 응답이 30초를 넘겼습니다" : m };
  }
}
