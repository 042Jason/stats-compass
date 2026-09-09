/**
 * Supabase 테이블 행 타입.
 *
 * 인계 문서에 명시된 컬럼은 명시적으로 선언하고, 그 외 컬럼은 index signature 로
 * 허용합니다. 실제 스키마와 이름이 다른 컬럼은 `normalize.ts` 의 후보 키 목록으로
 * 흡수하므로, 컬럼명이 달라도 화면이 깨지지 않고 해당 값만 비어 보입니다.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type Extra = { [key: string]: unknown };

/* 2026-09-09 Supabase public 스키마 실측 기준. index signature 는 유지합니다. */
/** AI 로 정제한 콘텐츠 (statistics.ai_content). 원문은 raw_meta 에 그대로 있습니다. */
export interface AiContent {
  summary?: string | null;
  overview?: string | null;
  terms?: Array<{ term: string; plain: string }>;
  cautions?: string[];
  sources?: Array<{ title: string; url: string }>;
  generated_at?: string | null;
}

export interface StatisticRow extends Extra {
  id: string;
  stat_id: string;
  stat_code?: string | null;
  approval_date?: string | null;
  name_ko: string;
  name_en?: string | null;
  agency?: string | null;
  category?: string | null;
  legal_basis?: string | null;
  purpose?: string | null;
  frequency?: string | null;
  tags?: string[] | Json | null;
  raw_meta?: Json | null;
  ai_content?: AiContent | Json | null;
  status?: string | null;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface StatisticTableRow extends Extra {
  id: string;
  statistic_id: string;
  kosis_org_id?: string | null;
  kosis_tbl_id?: string | null;
  table_name: string;
  category_path?: string | null;
  is_representative?: boolean | null;
  kosis_url?: string | null;
  latest_period?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface StatisticHistoryRow extends Extra {
  id: string;
  statistic_id: string;
  effective_from?: string | null;
  effective_to?: string | null;
  change_type?: string | null;
  change_summary?: string | null;
  change_document_url?: string | null;
  series_break?: boolean | null;
  source?: string | null;
  raw_data?: Json | null;
}

export interface CuratedSetRow extends Extra {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  is_published?: boolean | null;
  published_at?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CuratedSetItemRow extends Extra {
  id: string;
  set_id?: string | null;
  curated_set_id?: string | null;
  statistic_id: string;
  /** 실제 컬럼명은 position */
  position?: number | null;
  sort_order?: number | null;
  editor_note?: string | null;
  featured_table_id?: string | null;
  note?: string | null;
}

export interface DeepDiveArticleRow extends Extra {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  summary?: string | null;
  /** 실제 컬럼명은 body_markdown */
  body_markdown?: string | null;
  author_name?: string | null;
  reading_minutes?: number | null;
  body?: string | null;
  content?: string | null;
  statistic_id?: string | null;
  author?: string | null;
  is_published?: boolean | null;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface StatisticEventRow extends Extra {
  id: string;
  statistic_id?: string | null;
  event_type?: string | null;
  severity?: string | null;
  title?: string | null;
  description?: string | null;
  occurred_at?: string | null;
  auto_detected?: boolean | null;
  source_url?: string | null;
  payload?: Json | null;
}

/* ------------------------------------------------------------------ */
/* 화면용 정규화 모델                                                    */
/* ------------------------------------------------------------------ */

export interface TimelineItem {
  id: string;
  date: string | null; // ISO 혹은 'YYYY' / 'YYYY-MM'
  title: string;
  description: string | null;
  type: string | null;
  sourceUrl: string | null;
  statisticId: string | null;
}

export interface SearchHit {
  kind: "statistic" | "table";
  id: string;
  /** statistics.stat_id (테이블이면 상위 조사의 stat_id) */
  statId: string | null;
  title: string;
  subtitle: string | null;
  category: string | null;
  kosisUrl: string | null;
  rank: number;
}

export interface CategorySummary {
  category: string;
  count: number;
}

export type BrowseSort = "name" | "recent" | "agency";
