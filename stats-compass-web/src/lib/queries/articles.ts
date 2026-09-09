import "server-only";
import { getSupabase, safe, type QueryResult } from "@/lib/supabase/server";
import type { DeepDiveArticleRow } from "@/lib/types";

function sortArticles(rows: DeepDiveArticleRow[]): DeepDiveArticleRow[] {
  return [...rows].sort(
    (a, b) =>
      (Date.parse(b.published_at ?? b.created_at ?? "") || 0) -
      (Date.parse(a.published_at ?? a.created_at ?? "") || 0),
  );
}

export async function getPublishedArticles(limit = 50): Promise<QueryResult<DeepDiveArticleRow[]>> {
  const primary = await safe<DeepDiveArticleRow[]>(() =>
    getSupabase().from("deep_dive_articles").select("*").eq("is_published", true).limit(limit),
  );
  if (primary.error === null) return { data: sortArticles(primary.data), error: null };

  const fallback = await safe<DeepDiveArticleRow[]>(() =>
    getSupabase().from("deep_dive_articles").select("*").limit(limit),
  );
  if (fallback.error !== null) return fallback;
  return { data: sortArticles(fallback.data), error: null };
}

export async function getArticleBySlug(slug: string): Promise<QueryResult<DeepDiveArticleRow | null>> {
  const res = await safe<DeepDiveArticleRow[]>(() =>
    getSupabase().from("deep_dive_articles").select("*").eq("slug", slug).limit(1),
  );
  if (res.error !== null) return res;
  return { data: res.data[0] ?? null, error: null };
}

export async function getArticlesForStatistic(statisticId: string, limit = 5): Promise<DeepDiveArticleRow[]> {
  const res = await safe<DeepDiveArticleRow[]>(() =>
    getSupabase().from("deep_dive_articles").select("*").eq("statistic_id", statisticId).limit(limit),
  );
  return res.error !== null ? [] : sortArticles(res.data);
}
