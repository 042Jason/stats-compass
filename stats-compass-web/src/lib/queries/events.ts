import "server-only";
import { getSupabase, safe, type QueryResult } from "@/lib/supabase/server";
import type { StatisticEventRow, StatisticRow, TimelineItem } from "@/lib/types";
import { dateSortKey, toTimelineItem } from "@/lib/normalize";
import { getStatisticsByIds } from "./statistics";

export interface EventWithStatistic extends TimelineItem {
  statistic: { id: string; stat_id: string; name_ko: string; category: string | null } | null;
}

/** What's New 타임라인: 최신순, 조사 정보 포함 */
export async function getRecentEvents(limit = 100): Promise<QueryResult<EventWithStatistic[]>> {
  const res = await safe<StatisticEventRow[]>(() =>
    getSupabase().from("statistic_events").select("*").limit(limit),
  );
  if (res.error !== null) return res;

  const items = res.data.map(toTimelineItem).sort((a, b) => dateSortKey(b.date) - dateSortKey(a.date));

  const ids = [...new Set(items.map((i) => i.statisticId).filter((v): v is string => !!v))];
  const stats = await getStatisticsByIds(ids);
  const byId = new Map<string, StatisticRow>();
  if (stats.error === null) for (const s of stats.data) byId.set(s.id, s);

  return {
    data: items.map((i) => {
      const s = i.statisticId ? byId.get(i.statisticId) : undefined;
      return {
        ...i,
        statistic: s ? { id: s.id, stat_id: s.stat_id, name_ko: s.name_ko, category: s.category ?? null } : null,
      };
    }),
    error: null,
  };
}
