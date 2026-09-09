import "server-only";
import { getSupabase, safe, type QueryResult } from "@/lib/supabase/server";
import { EMPTY_SNAPSHOT, toSnapshot, type OntologySnapshot } from "@/lib/ontology";

/**
 * 온톨로지 전체 스냅샷.
 *
 * PostgREST 는 응답을 1,000행에서 자르기 때문에 관계를 행 단위로 받으면 안 됩니다.
 * RPC 가 노드·엣지를 jsonb 한 덩어리로 돌려줍니다.
 */
export async function getOntologySnapshot(): Promise<QueryResult<OntologySnapshot>> {
  const res = await safe<unknown>(() => getSupabase().rpc("ontology_snapshot"));
  if (res.error !== null) return res;
  return { data: toSnapshot(res.data), error: null };
}

/** 조사 상세 페이지용 — 그 조사와 직접 이어진 이웃만 */
export async function getOntologyForStatistic(
  statId: string,
  limit = 60,
): Promise<OntologySnapshot> {
  const res = await safe<unknown>(() =>
    getSupabase().rpc("ontology_for_statistic", { p_stat_id: statId, p_limit: limit }),
  );
  if (res.error !== null) return EMPTY_SNAPSHOT;
  return toSnapshot(res.data);
}
