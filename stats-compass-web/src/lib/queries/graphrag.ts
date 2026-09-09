import "server-only";
import { getSupabase, safe } from "@/lib/supabase/server";
import { embedQuery } from "@/lib/embedding";
import { EMPTY_RAG, toRagResult, type RagResult } from "@/lib/graphrag";
import { EMPTY_SLOTS, parseSlots, type ResolvedSlots } from "@/lib/slots";

export interface StageRow {
  key: string;
  label: string;
  description: string | null;
  order: number;
}

export interface NewsItem {
  title: string;
  url: string;
  publishedOn: string | null;
  department: string | null;
  survey: string | null;
  summary: string | null;
}

/** 생애단계 9개 (LifeStage 노드) */
export async function getLifeStages(): Promise<StageRow[]> {
  const res = await safe<Array<Record<string, unknown>>>(() =>
    getSupabase()
      .from("ontology_entities")
      .select("key, label, description, props")
      .eq("class_id", "LifeStage")
      .limit(50),
  );
  if (res.error !== null) return [];
  return res.data
    .map((r) => ({
      key: String(r.key ?? ""),
      label: String(r.label ?? ""),
      description: (r.description as string | null) ?? null,
      order: Number((r.props as Record<string, unknown> | null)?.order ?? 99),
    }))
    .filter((r) => r.key !== "")
    .sort((a, b) => a.order - b.order);
}

/** 예시 연구질문 */
export async function getSampleQuestions(limit = 8): Promise<string[]> {
  const res = await safe<Array<Record<string, unknown>>>(() =>
    getSupabase()
      .from("ontology_entities")
      .select("label")
      .eq("class_id", "ResearchQuestion")
      .limit(60),
  );
  if (res.error !== null) return [];
  const all = res.data.map((r) => String(r.label ?? "")).filter(Boolean);
  // 매번 같은 순서로 보이도록 길이순으로 안정 정렬한 뒤 앞에서 자릅니다.
  return all.sort((a, b) => a.length - b.length || a.localeCompare(b, "ko")).slice(0, limit);
}

export type RagOutcome =
  | { data: RagResult; news: NewsItem[]; slots: ResolvedSlots; error: null }
  | { data: null; news: never[]; slots: ResolvedSlots; error: string };

/**
 * 질문에서 나이·성별·지역을 뽑아 DB 규칙으로 해석합니다.
 *
 * 지역은 문장 전체를 resolve_region 에 넘깁니다. 지역명 목록은 Region 노드에
 * 이미 있으므로 코드에 또 두지 않습니다.
 */
async function resolveSlots(question: string): Promise<ResolvedSlots> {
  const parsed = parseSlots(question);
  const out: ResolvedSlots = { ...EMPTY_SLOTS, ...parsed };

  const [ageRes, regionRes] = await Promise.all([
    parsed.age === null
      ? Promise.resolve(null)
      : safe<unknown>(() => getSupabase().rpc("resolve_age", { p_age: parsed.age })),
    safe<unknown>(() => getSupabase().rpc("resolve_region", { p_text: question })),
  ]);

  if (ageRes && ageRes.error === null && ageRes.data && typeof ageRes.data === "object") {
    const d = ageRes.data as { bands?: Array<{ label?: unknown }>; stages?: Array<Record<string, unknown>> };
    out.ageBands = (d.bands ?? []).map((b) => String(b.label ?? "")).filter(Boolean);
    out.stages = (d.stages ?? [])
      .map((s) => ({ key: String(s.key ?? ""), label: String(s.label ?? "") }))
      .filter((s) => s.key !== "");
  }

  if (regionRes.error === null && Array.isArray(regionRes.data)) {
    out.regions = (regionRes.data as Array<Record<string, unknown>>)
      .map((r) => ({
        code: String(r.code ?? ""),
        label: String(r.label ?? ""),
        level: (r.level as string | null) ?? null,
        matched: (r.matched as string | null) ?? null,
      }))
      .filter((r) => r.label !== "");
  }

  return out;
}

/**
 * 질문 → 슬롯 해석 → 임베딩 → GraphRAG 검색 → 관련 보도자료까지.
 *
 * 임베딩은 서버에서만 만들고(키 노출 방지), 검색은 anon 권한 RPC 로 합니다.
 */
export async function searchGraphRag(
  question: string,
  stages: string[] = [],
  limit = 8,
): Promise<RagOutcome> {
  const [emb, slots] = await Promise.all([embedQuery(question), resolveSlots(question)]);
  if (emb.error !== null) return { data: null, news: [], slots, error: emb.error };

  const res = await safe<unknown>(() =>
    getSupabase().rpc("graphrag_search", {
      p_embedding: JSON.stringify(emb.vector),
      // p_query 를 빼먹으면 어휘 검색(pg_trgm)이 통째로 꺼집니다.
      // "월급 얼마" 같은 짧은 별칭은 벡터로는 못 잡고 여기서만 잡힙니다.
      p_query: question,
      p_stages: stages.length > 0 ? stages : null,
      p_seed_k: 14,
      p_limit: limit,
      // 지역을 물었으면 시군구·시도 단위가 있는 조사에 가산점을 줍니다.
      p_want_region: slots.regions.length > 0,
    }),
  );
  if (res.error !== null) return { data: null, news: [], slots, error: res.error };

  const data = toRagResult(res.data);
  if (data.surveys.length === 0) return { data, news: [], slots, error: null };

  const names = data.surveys.map((s) => s.label);
  const newsRes = await safe<unknown>(() =>
    getSupabase().rpc("news_for_surveys", { p_names: names, p_limit: 10 }),
  );
  const news: NewsItem[] =
    newsRes.error !== null || !Array.isArray(newsRes.data)
      ? []
      : (newsRes.data as Array<Record<string, unknown>>)
          .map((r) => ({
            title: String(r.title ?? ""),
            url: String(r.url ?? ""),
            publishedOn: (r.publishedOn as string | null) ?? null,
            department: (r.department as string | null) ?? null,
            survey: (r.survey as string | null) ?? null,
            summary: (r.summary as string | null) ?? null,
          }))
          .filter((r) => r.title !== "" && r.url !== "");

  return { data, news, slots, error: null };
}

export { EMPTY_RAG };
