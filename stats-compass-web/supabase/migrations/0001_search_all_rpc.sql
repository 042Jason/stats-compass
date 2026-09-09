-- ---------------------------------------------------------------------------
-- 통계나침반 검색 RPC: Postgres FTS(search_vector) + pg_trgm 하이브리드
--
-- 사전 조건 (이미 적용됨):
--   * create extension if not exists pg_trgm;
--   * statistics.search_vector, statistic_tables.search_vector (tsvector, 트리거 갱신)
--
-- 적용: Supabase 대시보드 → SQL Editor 에 붙여넣고 실행
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm;

-- trigram 인덱스 (부분 일치·오타 보정용). 이미 있으면 건너뜀
create index if not exists statistics_name_ko_trgm_idx
  on public.statistics using gin (name_ko gin_trgm_ops);
create index if not exists statistic_tables_table_name_trgm_idx
  on public.statistic_tables using gin (table_name gin_trgm_ops);

-- FTS 인덱스 (search_vector 에 없다면)
create index if not exists statistics_search_vector_idx
  on public.statistics using gin (search_vector);
create index if not exists statistic_tables_search_vector_idx
  on public.statistic_tables using gin (search_vector);

drop function if exists public.search_all(text, integer);

create or replace function public.search_all(q text, lim integer default 40)
returns table (
  kind       text,
  id         text,
  stat_id    text,
  title      text,
  subtitle   text,
  category   text,
  kosis_url  text,
  rank       real
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      trim(q)                                   as raw,
      websearch_to_tsquery('simple', trim(q))   as tsq
  ),
  stat_hits as (
    select
      'statistic'::text                          as kind,
      s.id::text                                 as id,
      s.stat_id::text                            as stat_id,
      s.name_ko::text                            as title,
      s.agency::text                             as subtitle,
      s.category::text                           as category,
      null::text                                 as kosis_url,
      greatest(
        coalesce(ts_rank_cd(s.search_vector, p.tsq), 0) * 2.0,   -- 조사명 매칭 가중치
        coalesce(similarity(s.name_ko, p.raw), 0),
        case when s.name_ko ilike '%' || p.raw || '%' then 0.6 else 0 end
      )::real                                    as rank
    from public.statistics s
    cross join params p
    where p.raw <> ''
      and (
        s.search_vector @@ p.tsq
        or s.name_ko % p.raw
        or s.name_ko ilike '%' || p.raw || '%'
        or coalesce(s.agency, '') ilike '%' || p.raw || '%'
      )
  ),
  table_hits as (
    select
      'table'::text                              as kind,
      t.id::text                                 as id,
      s.stat_id::text                            as stat_id,
      t.table_name::text                         as title,
      s.name_ko::text                            as subtitle,
      s.category::text                           as category,
      t.kosis_url::text                          as kosis_url,
      greatest(
        coalesce(ts_rank_cd(t.search_vector, p.tsq), 0),
        coalesce(similarity(t.table_name, p.raw), 0),
        case when t.table_name ilike '%' || p.raw || '%' then 0.5 else 0 end
      )::real                                    as rank
    from public.statistic_tables t
    join public.statistics s on s.id = t.statistic_id
    cross join params p
    where p.raw <> ''
      and (
        t.search_vector @@ p.tsq
        or t.table_name % p.raw
        or t.table_name ilike '%' || p.raw || '%'
      )
  )
  select * from (
    select * from stat_hits
    union all
    select * from table_hits
  ) hits
  order by rank desc, kind asc, title asc
  limit greatest(1, least(lim, 200));
$$;

grant execute on function public.search_all(text, integer) to anon, authenticated;

comment on function public.search_all(text, integer) is
  '통계나침반 통합 검색: statistics + statistic_tables 를 FTS/trigram/ILIKE 로 검색해 rank 순으로 반환';
