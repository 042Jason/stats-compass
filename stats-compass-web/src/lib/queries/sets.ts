import "server-only";
import { getSupabase, safe, type QueryResult } from "@/lib/supabase/server";
import type { CuratedSetItemRow, CuratedSetRow, StatisticRow } from "@/lib/types";
import { getStatisticsByIds } from "./statistics";

function sortSets(rows: CuratedSetRow[]): CuratedSetRow[] {
  return [...rows].sort((a, b) => {
    const ao = a.sort_order ?? 9999;
    const bo = b.sort_order ?? 9999;
    if (ao !== bo) return ao - bo;
    const ad = Date.parse(a.published_at ?? a.created_at ?? "") || 0;
    const bd = Date.parse(b.published_at ?? b.created_at ?? "") || 0;
    return bd - ad;
  });
}

/** 공개된 세트만. is_published 컬럼이 없으면 전체를 돌려줌 */
export async function getPublishedSets(limit = 50): Promise<QueryResult<CuratedSetRow[]>> {
  const primary = await safe<CuratedSetRow[]>(() =>
    getSupabase().from("curated_sets").select("*").eq("is_published", true).limit(limit),
  );
  if (primary.error === null) return { data: sortSets(primary.data), error: null };

  const fallback = await safe<CuratedSetRow[]>(() =>
    getSupabase().from("curated_sets").select("*").limit(limit),
  );
  if (fallback.error !== null) return fallback;
  return { data: sortSets(fallback.data), error: null };
}

export async function getSetBySlug(slug: string): Promise<QueryResult<CuratedSetRow | null>> {
  const res = await safe<CuratedSetRow[]>(() =>
    getSupabase().from("curated_sets").select("*").eq("slug", slug).limit(1),
  );
  if (res.error !== null) return res;
  return { data: res.data[0] ?? null, error: null };
}

export interface SetItemWithStatistic {
  item: CuratedSetItemRow;
  statistic: StatisticRow | null;
}

/** 세트에 담긴 통계 목록 (items → statistics 두 단계 조회로 FK 이름 의존 제거) */
export async function getSetItems(setId: string): Promise<QueryResult<SetItemWithStatistic[]>> {
  // FK 컬럼명이 set_id 인지 curated_set_id 인지 모르므로 순차 시도
  let items = await safe<CuratedSetItemRow[]>(() =>
    getSupabase().from("curated_set_items").select("*").eq("set_id", setId).limit(200),
  );
  if (items.error !== null) {
    items = await safe<CuratedSetItemRow[]>(() =>
      getSupabase().from("curated_set_items").select("*").eq("curated_set_id", setId).limit(200),
    );
  }
  if (items.error !== null) return items;

  // 실제 컬럼은 position (2026-09-09 스키마 확인). sort_order 는 예비.
  const order = (i: CuratedSetItemRow) => i.position ?? i.sort_order ?? 9999;
  const sorted = [...items.data].sort((a, b) => order(a) - order(b));
  const ids = sorted.map((i) => i.statistic_id).filter(Boolean);
  const stats = await getStatisticsByIds(ids);
  const byId = new Map<string, StatisticRow>();
  if (stats.error === null) for (const s of stats.data) byId.set(s.id, s);

  return {
    data: sorted.map((item) => ({ item, statistic: byId.get(item.statistic_id) ?? null })),
    error: null,
  };
}

/** 세트별 담긴 통계 수 (목록 카드 표시용) */
export async function getSetItemCounts(setIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (setIds.length === 0) return map;

  for (const fk of ["set_id", "curated_set_id"] as const) {
    const res = await safe<Record<string, string | null>[]>(() =>
      getSupabase().from("curated_set_items").select(fk).in(fk, setIds).limit(2000),
    );
    if (res.error !== null) continue;
    for (const r of res.data) {
      const k = r[fk] ?? "";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }
  return map;
}
