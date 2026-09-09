-- ============================================================================
-- 0005_lifecourse.sql — 생애나침반 (생애주기 GraphRAG POC)
--
-- 0004_ontology.sql 위에 얹습니다. 먼저 0004 를 실행해 두세요.
--   1) 생애단계·핵심지표·연구질문·관련기사·통계표 클래스와 관계 추가
--   2) 보도자료 원자료 테이블
--   3) pgvector 임베딩 테이블
--   4) GraphRAG 검색 RPC
--
-- Supabase SQL Editor 에서 통째로 실행하면 됩니다. 여러 번 실행해도 안전합니다.
-- ============================================================================

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- 1. 클래스 추가
-- ---------------------------------------------------------------------------

insert into public.ontology_classes (id, label, description, std_prefix, std_uri, sdmx_note, color, sort_order) values
  ('LifeStage', '생애단계',
   '태어나서 나이 들기까지의 국면입니다. 이 그래프의 시간축 역할을 합니다.',
   'skos', 'http://www.w3.org/2004/02/skos/core#Concept',
   'SDMX 의 Category Scheme 으로 표현할 수 있습니다.', '#0891b2', 15),

  ('Indicator', '핵심지표',
   '조사에서 실제로 공표되는 지표입니다. 같은 지표를 여러 조사가 내놓기도 합니다.',
   'qb', 'http://purl.org/linked-data/cube#MeasureProperty',
   'SDMX 의 Measure(개념 역할 Measure)에 대응합니다.', '#c026d3', 55),

  ('ResearchQuestion', '연구질문',
   '연구자가 실제로 던지는 질문입니다. 검색의 진입점이 됩니다.',
   null, null, null, '#059669', 45),

  ('NewsArticle', '보도자료',
   '국가데이터처가 낸 보도자료입니다. 통계가 실제로 어떻게 쓰이는지 보여 줍니다.',
   'dcat', 'http://www.w3.org/ns/dcat#Resource',
   null, '#78716c', 95)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  std_prefix = excluded.std_prefix, std_uri = excluded.std_uri,
  sdmx_note = excluded.sdmx_note, color = excluded.color, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2. 프로퍼티 추가
-- ---------------------------------------------------------------------------

insert into public.ontology_properties
  (id, label, description, domain_class, range_class, std_prefix, std_uri, is_symmetric, sort_order) values

  ('coversLifeStage', '다루는 생애단계', '이 조사가 다루는 생애단계입니다.',
   'Survey', 'LifeStage', 'skos', 'http://www.w3.org/2004/02/skos/core#related', false, 15),
  ('precedesStage', '다음 단계', '생애단계의 순서입니다.',
   'LifeStage', 'LifeStage', 'dct', 'http://purl.org/dc/terms/relation', false, 16),

  ('measuredBy', '산출하는 조사', '이 지표를 실제로 내놓는 조사입니다.',
   'Indicator', 'Survey', 'qb', 'http://purl.org/linked-data/cube#measure', false, 55),
  ('indicatorForStage', '지표의 생애단계', '이 지표가 주로 쓰이는 생애단계입니다.',
   'Indicator', 'LifeStage', 'skos', 'http://www.w3.org/2004/02/skos/core#related', false, 56),

  ('answeredBy', '답할 수 있는 조사', '이 질문에 답하려면 봐야 하는 조사입니다.',
   'ResearchQuestion', 'Survey', 'dct', 'http://purl.org/dc/terms/relation', false, 46),
  ('usesIndicator', '쓰는 지표', '이 질문에 답할 때 보는 지표입니다.',
   'ResearchQuestion', 'Indicator', 'dct', 'http://purl.org/dc/terms/relation', false, 47),
  ('questionForStage', '질문의 생애단계', '이 질문이 다루는 생애단계입니다.',
   'ResearchQuestion', 'LifeStage', 'skos', 'http://www.w3.org/2004/02/skos/core#related', false, 48),

  ('hasDistribution', '제공 통계표', '이 조사가 제공하는 KOSIS 통계표입니다.',
   'Survey', 'StatisticalTable', 'dcat', 'http://www.w3.org/ns/dcat#distribution', false, 35),

  ('mentionsSurvey', '인용한 조사', '이 보도자료가 근거로 삼은 조사입니다.',
   'NewsArticle', 'Survey', 'dct', 'http://purl.org/dc/terms/references', false, 96),
  ('mentionsIndicator', '인용한 지표', '이 보도자료가 언급한 지표입니다.',
   'NewsArticle', 'Indicator', 'dct', 'http://purl.org/dc/terms/references', false, 97)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  domain_class = excluded.domain_class, range_class = excluded.range_class,
  std_prefix = excluded.std_prefix, std_uri = excluded.std_uri,
  is_symmetric = excluded.is_symmetric, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 3. 보도자료 원자료
-- ---------------------------------------------------------------------------

create table if not exists public.news_articles (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'mods.go.kr',
  board_id      text,                       -- mods.go.kr 게시판 bid
  list_no       text,
  title         text not null,
  url           text not null,
  published_on  date,
  department    text,                       -- 담당부서
  summary       text,
  survey_name   text,                       -- 수집 시점에 매칭한 조사명
  raw           jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (source, url)
);

create index if not exists news_articles_survey_idx on public.news_articles (survey_name);
create index if not exists news_articles_date_idx   on public.news_articles (published_on desc);

alter table public.news_articles enable row level security;
drop policy if exists news_articles_read on public.news_articles;
create policy news_articles_read on public.news_articles
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. 임베딩 (OpenAI text-embedding-3-small = 1536차원)
-- ---------------------------------------------------------------------------

create table if not exists public.ontology_embeddings (
  entity_id  uuid primary key references public.ontology_entities(id) on delete cascade,
  model      text not null default 'text-embedding-3-small',
  content    text not null,               -- 임베딩에 쓴 원문 (재생성 판단용)
  content_hash text not null,
  embedding  vector(1536) not null,
  updated_at timestamptz not null default now()
);

-- 코사인 거리 기준 근사 최근접 인덱스. 행이 적으면 순차 스캔이 더 빠를 수 있습니다.
create index if not exists ontology_embeddings_vec_idx
  on public.ontology_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 50);

alter table public.ontology_embeddings enable row level security;
drop policy if exists ontology_embeddings_read on public.ontology_embeddings;
create policy ontology_embeddings_read on public.ontology_embeddings
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- 5. GraphRAG 검색
--
--   ① 질문 임베딩과 가까운 노드 몇 개를 seed 로 잡고 (벡터)
--   ② 그 seed 에서 관계를 1홉 타고 나가 조사에 도달한 뒤 (그래프)
--   ③ 유사도 × 감쇠 를 합산해 순위를 매기고
--   ④ 어떤 경로로 나왔는지 근거를 함께 돌려줍니다.
--
-- 순수 벡터 검색과 다른 점은 ②·④ 입니다. 질문에 조사 이름이 없어도
-- 개념·지표·연구질문 노드를 거쳐 조사로 이어집니다.
-- ---------------------------------------------------------------------------

create or replace function public.graphrag_search(
  p_embedding  vector(1536),
  p_stages     text[] default null,   -- LifeStage key 배열. null 이면 전 단계
  p_seed_k     int     default 14,
  p_limit      int     default 8
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with seeds as (
  select e.id, e.class_id, e.label,
         (1 - (m.embedding <=> p_embedding))::numeric as sim
  from public.ontology_embeddings m
  join public.ontology_entities e on e.id = m.entity_id
  where e.class_id in ('Survey', 'Concept', 'Indicator', 'ResearchQuestion',
                       'Keyword', 'Theme', 'StatisticalTable', 'LifeStage')
  order by m.embedding <=> p_embedding
  limit p_seed_k
),
-- seed 자신 + 1홉 이웃. 관계 종류에 따라 감쇠를 다르게 줍니다.
hop as (
  select s.id as seed_id, s.sim, s.label as seed_label, s.class_id as seed_class,
         s.id as node_id, null::text as property_id, null::text as evidence, 1.0::numeric as decay
  from seeds s
  union all
  select s.id, s.sim, s.label, s.class_id,
         case when r.source_id = s.id then r.target_id else r.source_id end,
         r.property_id, r.evidence,
         (case r.property_id
            when 'answeredBy'         then 0.95
            when 'hasDistribution'    then 0.85
            when 'measuredBy'         then 0.90
            when 'definesConcept'     then 0.80
            when 'usesIndicator'      then 0.75
            when 'sharesConceptWith'  then 0.60
            when 'oftenConfusedWith'  then 0.55
            when 'complements'        then 0.55
            when 'relatedTo'          then 0.45
            when 'hasKeyword'         then 0.45
            when 'hasTheme'           then 0.35
            when 'coversLifeStage'    then 0.35
            else 0.30
          end)::numeric
  from seeds s
  join public.ontology_relations r
    on (r.source_id = s.id or r.target_id = s.id)
),
-- 생애단계 필터: 지정한 단계를 다루는 조사만 남깁니다.
stage_ok as (
  select distinct r.source_id as survey_id
  from public.ontology_relations r
  join public.ontology_entities st on st.id = r.target_id
  where r.property_id = 'coversLifeStage'
    and (p_stages is null or st.key = any(p_stages))
),
ranked as (
  select h.node_id,
         e.label,
         s.stat_id,
         e.description,
         sum(h.sim * h.decay) as score,
         jsonb_agg(
           jsonb_build_object(
             'from', h.seed_label, 'fromClass', h.seed_class,
             'via', h.property_id, 'sim', round(h.sim, 3), 'why', h.evidence
           ) order by h.sim * h.decay desc
         ) filter (where h.property_id is not null or h.seed_id = h.node_id) as paths
  from hop h
  join public.ontology_entities e on e.id = h.node_id and e.class_id = 'Survey'
  left join public.statistics s on s.id = e.statistic_id
  where (p_stages is null or h.node_id in (select survey_id from stage_ok))
  group by h.node_id, e.label, s.stat_id, e.description
  order by score desc
  limit p_limit
)
select jsonb_build_object(
  'seeds', coalesce((
    select jsonb_agg(jsonb_build_object('label', label, 'class', class_id, 'sim', round(sim, 3))
                     order by sim desc)
    from seeds
  ), '[]'::jsonb),
  'surveys', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', node_id, 'label', label, 'statId', stat_id,
      'overview', description, 'score', round(score, 4),
      'paths', (select jsonb_agg(p) from (
                  select p from jsonb_array_elements(paths) p limit 4
                ) t)
    ) order by score desc)
    from ranked
  ), '[]'::jsonb),
  -- 상위 조사가 제공하는 통계표 중 질문과 가까운 것
  'tables', coalesce((
    select jsonb_agg(x order by x->'score' desc)
    from (
      select jsonb_build_object(
        'label', e.label,
        'orgId', e.props->>'orgId',
        'tblId', e.props->>'tblId',
        'latestPeriod', e.props->>'latestPeriod',
        'survey', se.label,
        'score', round((1 - (m.embedding <=> p_embedding))::numeric, 4)
      ) as x
      from public.ontology_relations r
      join public.ontology_entities e  on e.id = r.target_id and e.class_id = 'StatisticalTable'
      join public.ontology_entities se on se.id = r.source_id
      join public.ontology_embeddings m on m.entity_id = e.id
      where r.property_id = 'hasDistribution'
        and r.source_id in (select node_id from ranked)
      order by m.embedding <=> p_embedding
      limit 8
    ) t
  ), '[]'::jsonb),
  -- 뽑힌 조사들 사이의 '헷갈리는 쌍' 경고
  'cautions', coalesce((
    select jsonb_agg(distinct jsonb_build_object(
      'a', ea.label, 'b', eb.label, 'why', r.evidence))
    from public.ontology_relations r
    join public.ontology_entities ea on ea.id = r.source_id
    join public.ontology_entities eb on eb.id = r.target_id
    where r.property_id = 'oftenConfusedWith'
      and r.source_id in (select node_id from ranked)
      and r.target_id in (select node_id from ranked)
  ), '[]'::jsonb)
);
$$;

-- 조사 이름으로 관련 보도자료 가져오기
create or replace function public.news_for_surveys(p_names text[], p_limit int default 12)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x->>'publishedOn' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'title', n.title, 'url', n.url, 'publishedOn', n.published_on,
      'department', n.department, 'survey', n.survey_name, 'summary', n.summary
    ) as x
    from public.news_articles n
    where n.survey_name = any(p_names)
    order by n.published_on desc nulls last
    limit p_limit
  ) t;
$$;

grant execute on function public.graphrag_search(vector, text[], int, int) to anon, authenticated;
grant execute on function public.news_for_surveys(text[], int)             to anon, authenticated;

notify pgrst, 'reload schema';
