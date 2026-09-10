import "server-only";
import { getSupabase, safe, type QueryResult } from "@/lib/supabase/server";
import { PAGE_SIZE } from "@/lib/constants";
import type {
  BrowseSort,
  CategorySummary,
  StatisticEventRow,
  StatisticHistoryRow,
  StatisticRow,
  StatisticTableRow,
  TimelineItem,
} from "@/lib/types";
import { dateSortKey, toTimelineItem } from "@/lib/normalize";

/**
 * 목록 카드에 필요한 컬럼. 시드 스크립트가 채우는 컬럼(stat_id, name_ko, agency,
 * category, frequency, status, purpose)은 확실하지만 name_en / tags / updated_at 은
 * 스키마에 따라 없을 수 있어, 실패하면 `*` 로 재시도합니다.
 */
const STAT_LIST_COLUMNS =
  "id, stat_id, name_ko, name_en, agency, category, frequency, tags, status, purpose, summary, updated_at";
const STAT_LIST_FALLBACK = "*";
const COLUMN_ATTEMPTS = [STAT_LIST_COLUMNS, STAT_LIST_FALLBACK];

/** 테이블·컬럼 자체가 없는 경우(PostgREST 42P01 / 42703)인지 */
function isMissingSchema(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("could not find the table") ||
    m.includes("could not find the") ||
    m.includes("schema cache") ||
    m.includes("42p01") ||
    m.includes("42703")
  );
}

/**
 * select() 에 동적 컬럼 문자열을 넘기면 supabase-js 가 결과 타입을 추론하지 못합니다.
 * 실행 결과 형태는 동일하므로 안전하게 좁혀 줍니다.
 */
type Resp<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
function asResp<T>(builder: unknown): Resp<T> {
  return builder as Resp<T>;
}

/**
 * 재그룹핑으로 다른 조사에 흡수된 행(status='merged')을 목록에서 제외합니다.
 * status 가 NULL 인 행도 남겨야 하므로 neq 단독으로는 안 됩니다
 * (PostgREST 에서 NULL <> 'merged' 는 NULL 이라 아예 제외되어 버립니다).
 */
const NOT_MERGED = "status.is.null,status.neq.merged";

/** 여러 시도를 순서대로 실행해 처음 성공한 결과를 반환 */
async function firstSuccess<T>(attempts: Array<() => Promise<QueryResult<T>>>): Promise<QueryResult<T>> {
  let last: QueryResult<T> = { data: null, error: "no attempt" };
  for (const attempt of attempts) {
    last = await attempt();
    if (last.error === null) return last;
  }
  return last;
}

/* ------------------------------------------------------------------ */
/* 카테고리                                                               */
/* ------------------------------------------------------------------ */

export async function getCategorySummaries(): Promise<QueryResult<CategorySummary[]>> {
  const res = await safe<Pick<StatisticRow, "category">[]>(() =>
    getSupabase().from("statistics").select("category").or(NOT_MERGED).limit(2000),
  );
  if (res.error !== null) return res;
  const counts = new Map<string, number>();
  for (const row of res.data) {
    const c = (row.category ?? "").trim();
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const list = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, "ko"));
  return { data: list, error: null };
}

/* ------------------------------------------------------------------ */
/* 목록                                                                   */
/* ------------------------------------------------------------------ */

export interface BrowseParams {
  category?: string;
  sort?: BrowseSort;
  page?: number;
  pageSize?: number;
}

export interface BrowseResult {
  items: StatisticRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getStatistics(params: BrowseParams = {}): Promise<QueryResult<BrowseResult>> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const build = (columns: string, sort: BrowseSort | "none") => {
    let q = getSupabase().from("statistics").select(columns, { count: "exact" }).or(NOT_MERGED);
    if (params.category) q = q.eq("category", params.category);
    if (sort === "recent") q = q.order("updated_at", { ascending: false, nullsFirst: false });
    else if (sort === "agency") q = q.order("agency", { ascending: true }).order("name_ko");
    else if (sort === "name") q = q.order("name_ko", { ascending: true });
    return q.range(from, to);
  };

  const run = async (columns: string, sort: BrowseSort | "none"): Promise<QueryResult<BrowseResult>> => {
    try {
      const { data, error, count } = await build(columns, sort);
      if (error) return { data: null, error: error.message };
      const total = count ?? data?.length ?? 0;
      return {
        data: {
          items: (data ?? []) as unknown as StatisticRow[],
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
        error: null,
      };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const sort = params.sort ?? "name";
  return firstSuccess(
    COLUMN_ATTEMPTS.flatMap((cols) => [() => run(cols, sort), () => run(cols, "none")]),
  );
}

export async function getRecentStatistics(limit = 6): Promise<QueryResult<StatisticRow[]>> {
  const run = (columns: string, ordered: boolean) =>
    safe<StatisticRow[]>(() => {
      const q = getSupabase().from("statistics").select(columns).or(NOT_MERGED);
      const ordering = ordered ? q.order("updated_at", { ascending: false, nullsFirst: false }) : q;
      return asResp<StatisticRow[]>(ordering.limit(limit));
    });

  return firstSuccess(
    COLUMN_ATTEMPTS.flatMap((cols) => [() => run(cols, true), () => run(cols, false)]),
  );
}

export async function getStatisticCount(): Promise<number> {
  try {
    const { count } = await getSupabase()
      .from("statistics")
      .select("id", { count: "exact", head: true })
      .or(NOT_MERGED);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getTableCount(): Promise<number> {
  try {
    const { count } = await getSupabase()
      .from("statistic_tables")
      .select("id", { count: "exact", head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** sitemap 및 정적 경로 생성용 */
export async function getAllStatIds(): Promise<string[]> {
  const res = await safe<Pick<StatisticRow, "stat_id">[]>(() =>
    getSupabase().from("statistics").select("stat_id").or(NOT_MERGED).limit(5000),
  );
  return res.error !== null ? [] : res.data.map((r) => r.stat_id).filter(Boolean);
}

export async function getStatisticsByIds(ids: string[]): Promise<QueryResult<StatisticRow[]>> {
  if (ids.length === 0) return { data: [], error: null };
  return firstSuccess(
    COLUMN_ATTEMPTS.map(
      (cols) => () =>
        safe<StatisticRow[]>(() =>
          asResp<StatisticRow[]>(getSupabase().from("statistics").select(cols).in("id", ids)),
        ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* 상세                                                                   */
/* ------------------------------------------------------------------ */

export async function getStatisticByStatId(statId: string): Promise<QueryResult<StatisticRow | null>> {
  const res = await safe<StatisticRow[]>(() =>
    getSupabase().from("statistics").select("*").eq("stat_id", statId).limit(1),
  );
  if (res.error !== null) return res;
  return { data: res.data[0] ?? null, error: null };
}

export async function getTablesForStatistic(statisticId: string): Promise<QueryResult<StatisticTableRow[]>> {
  return firstSuccess<StatisticTableRow[]>([
    () =>
      safe<StatisticTableRow[]>(() =>
        getSupabase()
          .from("statistic_tables")
          .select("*")
          .eq("statistic_id", statisticId)
          .order("is_representative", { ascending: false, nullsFirst: false })
          .order("display_order", { ascending: true, nullsFirst: false })
          .limit(500),
      ),
    () =>
      safe<StatisticTableRow[]>(() =>
        getSupabase()
          .from("statistic_tables")
          .select("*")
          .eq("statistic_id", statisticId)
          .order("is_representative", { ascending: false, nullsFirst: false })
          .order("table_name", { ascending: true })
          .limit(500),
      ),
    () =>
      safe<StatisticTableRow[]>(() =>
        getSupabase().from("statistic_tables").select("*").eq("statistic_id", statisticId).limit(500),
      ),
  ]);
}

/**
 * 연혁·소식은 아직 스키마가 확정되지 않은 선택 기능입니다.
 * 테이블이 없으면 오류 대신 빈 목록으로 처리해 상세 페이지가 깨지지 않게 합니다.
 */
async function optionalTimeline(
  table: "statistic_history" | "statistic_events",
  statisticId: string,
  limit: number,
): Promise<QueryResult<TimelineItem[]>> {
  const res = await safe<Array<StatisticHistoryRow | StatisticEventRow>>(() =>
    getSupabase().from(table).select("*").eq("statistic_id", statisticId).limit(limit),
  );
  if (res.error !== null) {
    return isMissingSchema(res.error) ? { data: [], error: null } : res;
  }
  const items = res.data.map(toTimelineItem).sort((a, b) => dateSortKey(b.date) - dateSortKey(a.date));
  return { data: items, error: null };
}

export async function getHistoryForStatistic(statisticId: string): Promise<QueryResult<TimelineItem[]>> {
  return optionalTimeline("statistic_history", statisticId, 200);
}

export async function getEventsForStatistic(statisticId: string): Promise<QueryResult<TimelineItem[]>> {
  return optionalTimeline("statistic_events", statisticId, 100);
}

/** 같은 카테고리의 다른 조사 (상세 페이지 하단 추천) */
export async function getRelatedStatistics(
  category: string | null | undefined,
  excludeId: string,
  limit = 4,
): Promise<StatisticRow[]> {
  if (!category) return [];
  const res = await firstSuccess<StatisticRow[]>(
    COLUMN_ATTEMPTS.map(
      (cols) => () =>
        safe<StatisticRow[]>(() =>
          asResp<StatisticRow[]>(
            getSupabase()
              .from("statistics")
              .select(cols)
              .or(NOT_MERGED)
              .eq("category", category)
              .neq("id", excludeId)
              .limit(limit),
          ),
        ),
    ),
  );
  return res.error !== null ? [] : res.data;
}
