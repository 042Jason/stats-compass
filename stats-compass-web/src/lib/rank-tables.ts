import "server-only";
import type { RagTable } from "@/lib/graphrag";

/**
 * 찾아낸 통계표를 <질문에 맞는 순서>로 다시 늘어놓습니다.
 *
 * ── 검색 알고리즘은 건드리지 않습니다
 * 무엇을 찾을지는 GraphRAG 가 정합니다. 이 층은 이미 찾아낸 것의 <순서만> 바꿉니다.
 * 목록에 없던 표를 새로 넣지도, 있던 표를 빼지도 않습니다. 그래서 반환값을
 * 순열(permutation)로 검사합니다 — 원소가 하나라도 늘거나 줄면 통째로 버리고
 * 검색 순서를 그대로 씁니다.
 *
 * ── 왜 필요한가
 * 검색 점수는 "질문 전체와 얼마나 가까운가" 입니다. 그런데 사람이 실제로 먼저 열고
 * 싶은 표는 질문의 <초점>에 달려 있습니다. "집을 사려면 빚을 얼마나" 는 주택 관련
 * 표가 여럿 걸려도 대출·부채 표를 먼저 봐야 합니다. 점수로는 그 차이가 안 납니다.
 *
 * ── 왜 번호로 주고받는가
 * tblId 가 없는 표가 섞여 있고, 모델이 ID 문자열을 한 글자 틀리게 옮겨 적는 일이
 * 흔합니다. 0부터 시작하는 번호는 틀릴 여지가 훨씬 적고 검증도 쉽습니다.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const SYSTEM = `당신은 통계 사서입니다. 이용자의 질문을 읽고, 이미 찾아 둔 통계표 목록을 <먼저 열어야 할 순서>로 다시 늘어놓습니다.

지켜야 할 것:
- 목록에 있는 번호만 씁니다. 새 표를 지어내지 마세요.
- 모든 번호를 빠짐없이 정확히 한 번씩 씁니다. 빼고 싶은 표는 뒤로 미세요.
- 질문의 <초점>을 봅니다. "집을 사려면 빚을 얼마나" 의 초점은 주택이 아니라 대출·부채입니다.
- 그 다음 기준은 이 순서입니다: 질문의 인구집단(나이·성별·지역)을 실제로 나눠 주는가 → 최신 시점인가 → 조사가 서로 겹치지 않는가.
- 같은 조사의 표만 앞에 몰지 마세요. 상위 5개 안에는 조사가 최소 두 개는 섞이는 편이 좋습니다.

reason 은 그 표를 그 자리에 둔 이유를 15자 안팎으로 적습니다. 상위 4개까지만 적고 나머지는 비웁니다.

JSON 으로만 답합니다:
{"order":[정수 배열], "reasons":{"번호":"이유"}, "focus":"질문의 초점 한 마디"}`;

export interface RankResult {
  /** tables 배열의 새 순서. 길이·구성은 입력과 같습니다 */
  order: number[];
  /** 원본 번호 → 짧은 이유 */
  reasons: Record<number, string>;
  /** 모델이 읽어낸 질문의 초점 */
  focus: string | null;
  error: string | null;
}

function identity(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * 모델이 준 배열을 <반드시 순열로> 만듭니다.
 *
 * 범위 밖·중복을 버리고, 빠진 번호는 원래 순서대로 뒤에 붙입니다. 이렇게 하면
 * 모델이 절반만 답해도 앞쪽 의도는 살리고 나머지는 검색 순서를 지킵니다.
 */
export function toPermutation(raw: unknown, n: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const i = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) continue;
      seen.add(i);
      out.push(i);
    }
  }
  for (const i of identity(n)) if (!seen.has(i)) out.push(i);
  return out;
}

function clip(s: string | null | undefined, n: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function buildContext(question: string, tables: RagTable[]): string {
  const lines = [`<질문>\n${question}\n</질문>`, "", "<통계표 목록>"];
  tables.forEach((t, i) => {
    const span = [t.firstPeriod, t.latestPeriod].filter(Boolean).join("~");
    const bits = [
      t.survey ? `조사: ${t.survey}` : null,
      span ? `수록: ${span}` : null,
      t.directHit ? "질문에 직접 걸린 표" : null,
    ].filter(Boolean);
    lines.push(`${i}. ${clip(t.label, 120)}${bits.length > 0 ? ` — ${bits.join(", ")}` : ""}`);
  });
  lines.push("</통계표 목록>");
  return lines.join("\n");
}

export async function rankTables(question: string, tables: RagTable[]): Promise<RankResult> {
  const n = tables.length;
  const fallback = (error: string | null): RankResult => ({
    order: identity(n),
    reasons: {},
    focus: null,
    error,
  });

  if (n < 2) return fallback(null);

  const key = process.env.OPENAI_API_KEY;
  if (!key) return fallback("OPENAI_API_KEY 가 없습니다.");

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildContext(question, tables) },
        ],
      }),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return fallback(`정렬 호출 실패 (${res.status}) ${detail}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return fallback("정렬 응답이 비어 있습니다.");

    const parsed = JSON.parse(text) as {
      order?: unknown;
      reasons?: Record<string, unknown>;
      focus?: unknown;
    };

    const order = toPermutation(parsed.order, n);

    const reasons: Record<number, string> = {};
    for (const [k, v] of Object.entries(parsed.reasons ?? {})) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < n && typeof v === "string" && v.trim()) {
        reasons[i] = clip(v, 40);
      }
    }

    return {
      order,
      reasons,
      focus: typeof parsed.focus === "string" && parsed.focus.trim() ? clip(parsed.focus, 60) : null,
      error: null,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return fallback(m.includes("timeout") ? "정렬이 20초를 넘겼습니다" : m);
  }
}
