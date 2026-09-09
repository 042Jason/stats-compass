import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";
import { getAllStatIds } from "@/lib/queries/statistics";
import { getPublishedSets } from "@/lib/queries/sets";
import { getPublishedArticles } from "@/lib/queries/articles";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = ["", "/browse", "/sets", "/whats-new", "/deep-dives", "/search"].map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: now,
    changeFrequency: p === "" ? "daily" : "weekly",
    priority: p === "" ? 1 : 0.7,
  }));

  const [statIds, sets, articles] = await Promise.all([getAllStatIds(), getPublishedSets(500), getPublishedArticles(500)]);

  return [
    ...staticRoutes,
    ...statIds.map((id) => ({
      url: `${SITE_URL}/statistics/${encodeURIComponent(id)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...(sets.error !== null ? [] : sets.data).map((s) => ({
      url: `${SITE_URL}/sets/${encodeURIComponent(s.slug)}`,
      lastModified: s.updated_at ? new Date(s.updated_at) : now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...(articles.error !== null ? [] : articles.data).map((a) => ({
      url: `${SITE_URL}/deep-dives/${encodeURIComponent(a.slug)}`,
      lastModified: a.updated_at ? new Date(a.updated_at) : now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
