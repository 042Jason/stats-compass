import "server-only";
import { getSupabase } from "@/lib/supabase/server";
import type { SearchHit, StatisticRow, StatisticTableRow } from "@/lib/types";
import { shortAgency } from "@/lib/agency";

export interface SearchResponse {
  hits: SearchHit[];
  /** 'rpc' = search_all 함수, 'fallback' = 클라이언트 측 FTS/ILIKE 조합 */
  mode: "rpc" | "fallback";
  error: string | null;
}

interface RpcRow {
  kind: "statistic" | "table";
  id: string;
  stat_id: string | null;
  title: string;
  subtitle: string | null;
  category: string | null;
  kosis_url: string | null;
  rank: number;
}

export function normalizeQuery(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}

/**
 * 통합 검색.
 * 1) DB 함수 `search_all` (FTS + pg_trgm 하이브리드) 우선
 * 2) 함수가 없거나 실패하면 Supabase 클라이언트의 textSearch + ilike 조합으로 대체
 */
export async function searchAll(rawQuery: string, limit = 40): Promise<SearchResponse> {
  const q = normalizeQuery(rawQuery);
  if (!q) return { hits: [], mode: "rpc", error: null };

  const supabase = getSupabase();

  try {
    const { data, error } = await supabase.rpc("search_all", { q, lim: limit });
    if (!error && Array.isArray(data)) {
      const hits = (data as RpcRow[]).map<SearchHit>((r) => ({
        kind: r.kind,
        id: String(r.id),
        statId: r.stat_id,
        title: r.title,
        subtitle: r.subtitle,
        category: r.category,
        kosisUrl: r.kosis_url,
        rank: Number(r.rank ?? 0),
      }));
      return { hits, mode: "rpc", error: null };
    }
    if (error) console.warn("[search] rpc 실패, fallback 사용:", error.message);
  } catch (e) {
    console.warn("[search] rpc 예외, fallback 사용:", e);
  }

  return fallbackSearch(q, limit);
}

async function fallbackSearch(q: string, limit: number): Promise<SearchResponse> {
  const supabase = getSupabase();
  const like = `%${q.replace(/[%_]/g, "")}%`;

  const statCols = "id, stat_id, name_ko, agency, category";
  const tableCols = "id, statistic_id, table_name, kosis_url";

  try {
    const [statFts, statLike, tableFts, tableLike] = await Promise.all([
      supabase.from("statistics").select(statCols).or("status.is.null,status.neq.merged").textSearch("search_vector", q, { type: "websearch", config: "simple" }).limit(limit),
      supabase.from("statistics").select(statCols).or("status.is.null,status.neq.merged").or(`name_ko.ilike.${like},agency.ilike.${like}`).limit(limit),
      supabase.from("statistic_tables").select(tableCols).textSearch("search_vector", q, { type: "websearch", config: "simple" }).limit(limit),
      supabase.from("statistic_tables").select(tableCols).ilike("table_name", like).limit(limit),
    ]);

    const statMap = new Map<string, { row: StatisticRow; rank: number }>();
    for (const r of (statFts.data ?? []) as unknown as StatisticRow[]) statMap.set(r.id, { row: r, rank: 2 });
    for (const r of (statLike.data ?? []) as unknown as StatisticRow[]) {
      const cur = statMap.get(r.id);
      statMap.set(r.id, { row: r, rank: (cur?.rank ?? 0) + 1.2 });
    }

    const tableMap = new Map<string, { row: StatisticTableRow; rank: number }>();
    for (const r of (tableFts.data ?? []) as unknown as StatisticTableRow[]) tableMap.set(r.id, { row: r, rank: 1 });
    for (const r of (tableLike.data ?? []) as unknown as StatisticTableRow[]) {
      const cur = tableMap.get(r.id);
      tableMap.set(r.id, { row: r, rank: (cur?.rank ?? 0) + 0.8 });
    }

    // 통계표의 상위 조사 정보
    const parentIds = [...new Set([...tableMap.values()].map((t) => t.row.statistic_id))];
    const parents = new Map<string, StatisticRow>();
    if (parentIds.length) {
      const { data } = await supabase.from("statistics").select(statCols).or("status.is.null,status.neq.merged").in("id", parentIds);
      for (const p of (data ?? []) as unknown as StatisticRow[]) parents.set(p.id, p);
    }

    const hits: SearchHit[] = [
      ...[...statMap.values()].map<SearchHit>(({ row, rank }) => ({
        kind: "statistic",
        id: row.id,
        statId: row.stat_id,
        title: row.name_ko,
        // 검색 결과 목록도 카드와 같은 규칙 — 전부 국가데이터처라 과명만 보여 줍니다.
        subtitle: shortAgency(row.agency),
        category: row.category ?? null,
        kosisUrl: null,
        rank,
      })),
      ...[...tableMap.values()].map<SearchHit>(({ row, rank }) => {
        const p = parents.get(row.statistic_id);
        return {
          kind: "table",
          id: row.id,
          statId: p?.stat_id ?? null,
          title: row.table_name,
          subtitle: p?.name_ko ?? null,
          category: p?.category ?? null,
          kosisUrl: row.kosis_url ?? null,
          rank,
        };
      }),
    ]
      .sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title, "ko"))
      .slice(0, limit);

    const firstError = [statFts, statLike, tableFts, tableLike].find((r) => r.error)?.error?.message ?? null;
    return { hits, mode: "fallback", error: hits.length === 0 ? firstError : null };
  } catch (e) {
    return { hits: [], mode: "fallback", error: e instanceof Error ? e.message : String(e) };
  }
}
