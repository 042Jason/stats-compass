-- ============================================================================
-- 0006_hybrid.sql — 별칭·설명자료 임베딩 + 하이브리드 GraphRAG
--
-- 0005_lifecourse.sql 다음에 실행합니다.
--
-- 바뀌는 것
--   1) ontology_embeddings 를 노드 1:N 으로 재설계
--      · main  — 노드 본문 (라벨 + 정제 개요)
--      · alias — 별칭 하나하나가 독립 벡터 ("노후 생활비" 자체가 검색 대상)
--      · meta  — KOSIS 원문 설명자료를 항목별로 자른 청크 (조사목적·조사항목·주요용어 …)
--   2) pg_trgm 어휘 검색을 붙여 벡터와 순위를 합칩니다 (RRF)
--   3) graphrag_search 가 조사뿐 아니라 용어정의·지표·지나온 관계까지 돌려줍니다
--
-- 임베딩 구조가 바뀌므로 기존 테이블은 버리고 다시 만듭니다.
-- 실행 후 반드시 `npx tsx src/seed/15_embed.ts` 를 다시 돌리세요.
-- ============================================================================

create extension if not exists vector;
create extension if not exists pg_trgm;

drop function if exists public.graphrag_search(vector, text[], int, int);
drop table if exists public.ontology_embeddings;

create table public.ontology_embeddings (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references public.ontology_entities(id) on delete cascade,
  kind         text not null default 'main',   -- main | alias | meta
  field        text,                           -- meta 일 때 원문 항목명 (예: 조사항목)
  content      text not null,
  content_hash text not null,
  model        text not null default 'text-embedding-3-small',
  embedding    vector(1536) not null,
  updated_at   timestamptz not null default now(),
  unique (entity_id, content_hash)
);

create index ontology_embeddings_vec_idx
  on public.ontology_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index ontology_embeddings_trgm_idx
  on public.ontology_embeddings using gin (content gin_trgm_ops);
create index ontology_embeddings_entity_idx on public.ontology_embeddings (entity_id);
create index ontology_embeddings_kind_idx   on public.ontology_embeddings (kind);

alter table public.ontology_embeddings enable row level security;
drop policy if exists ontology_embeddings_read on public.ontology_embeddings;
create policy ontology_embeddings_read on public.ontology_embeddings
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- 하이브리드 GraphRAG
--
--   ① 벡터 검색과 어휘 검색(pg_trgm)을 따로 돌려 각각 순위를 냅니다
--   ② RRF(Reciprocal Rank Fusion)로 순위를 합칩니다. 점수 스케일이 달라도 섞입니다
--   ③ 합쳐진 진입 노드에서 관계를 1홉 타고 조사에 도달합니다
--   ④ 조사 · 용어정의 · 지표 · 통계표 · 지나온 관계 · 경고를 함께 돌려줍니다
-- ---------------------------------------------------------------------------

create or replace function public.graphrag_search(
  p_embedding vector(1536),
  p_query     text    default null,   -- 어휘 검색용 원문 질의. null 이면 벡터만
  p_stages    text[]  default null,
  p_seed_k    int     default 16,
  p_limit     int     default 8
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
-- ① 벡터 순위
vec as (
  select m.id, m.entity_id, m.kind, m.field, m.content,
         (1 - (m.embedding <=> p_embedding))::numeric as sim,
         row_number() over (order by m.embedding <=> p_embedding) as rnk
  from public.ontology_embeddings m
  order by m.embedding <=> p_embedding
  limit p_seed_k * 3
),
-- ② 어휘 순위 (정확한 용어를 넣었을 때 벡터가 놓치는 것을 잡습니다)
lex as (
  select m.id, m.entity_id, m.kind, m.field, m.content,
         similarity(m.content, coalesce(p_query, ''))::numeric as sim,
         row_number() over (order by similarity(m.content, coalesce(p_query, '')) desc) as rnk
  from public.ontology_embeddings m
  where p_query is not null
    and length(p_query) >= 2
    and m.content % p_query
  limit p_seed_k * 3
),
-- ③ RRF 로 합산 (k=60 은 관행값)
fused as (
  select id, entity_id, kind, field, content,
         max(sim) as sim,
         sum(1.0 / (60 + rnk)) as rrf
  from (
    select id, entity_id, kind, field, content, sim, rnk from vec
    union all
    select id, entity_id, kind, field, content, sim, rnk from lex
  ) u
  group by id, entity_id, kind, field, content
),
-- 노드 하나당 가장 잘 맞은 청크 하나만 남깁니다
seeds as (
  select distinct on (f.entity_id)
         f.entity_id, f.kind, f.field, f.content, f.sim, f.rrf,
         e.class_id, e.label
  from fused f
  join public.ontology_entities e on e.id = f.entity_id
  order by f.entity_id, f.rrf desc
),
top_seeds as (
  select * from seeds order by rrf desc limit p_seed_k
),
-- ④ 진입 노드 + 1홉 이웃
hop as (
  select s.entity_id as seed_id, s.rrf, s.sim, s.label as seed_label, s.class_id as seed_class,
         s.entity_id as node_id, null::text as property_id, null::text as evidence, 1.0::numeric as decay
  from top_seeds s
  union all
  select s.entity_id, s.rrf, s.sim, s.label, s.class_id,
         case when r.source_id = s.entity_id then r.target_id else r.source_id end,
         r.property_id, r.evidence,
         (case r.property_id
            when 'answeredBy'         then 0.95
            when 'measuredBy'         then 0.90
            when 'hasDistribution'    then 0.85
            when 'definesConcept'     then 0.80
            when 'usesIndicator'      then 0.75
            when 'broaderConcept'     then 0.60
            when 'sharesConceptWith'  then 0.60
            when 'oftenConfusedWith'  then 0.55
            when 'complements'        then 0.55
            when 'relatedConcept'     then 0.50
            when 'relatedTo'          then 0.45
            when 'hasKeyword'         then 0.45
            when 'coversLifeStage'    then 0.35
            when 'hasTheme'           then 0.35
            else 0.30
          end)::numeric
  from top_seeds s
  join public.ontology_relations r
    on (r.source_id = s.entity_id or r.target_id = s.entity_id)
),
stage_ok as (
  select distinct r.source_id as survey_id
  from public.ontology_relations r
  join public.ontology_entities st on st.id = r.target_id
  where r.property_id = 'coversLifeStage'
    and (p_stages is null or st.key = any(p_stages))
),
ranked as (
  select h.node_id, e.label, s.stat_id, e.description,
         sum(h.rrf * h.decay) as score,
         jsonb_agg(jsonb_build_object(
           'from', h.seed_label, 'fromClass', h.seed_class,
           'via', h.property_id, 'sim', round(h.sim, 3), 'why', h.evidence
         ) order by h.rrf * h.decay desc) as paths
  from hop h
  join public.ontology_entities e on e.id = h.node_id and e.class_id = 'Survey'
  left join public.statistics s on s.id = e.statistic_id
  where (p_stages is null or h.node_id in (select survey_id from stage_ok))
  group by h.node_id, e.label, s.stat_id, e.description
  order by score desc
  limit p_limit
)
select jsonb_build_object(

  -- 어디로 들어왔나 (별칭으로 걸렸는지, 설명자료 원문으로 걸렸는지가 보입니다)
  'seeds', coalesce((
    select jsonb_agg(jsonb_build_object(
      'label', label, 'class', class_id, 'kind', kind, 'field', field,
      'sim', round(sim, 3),
      'quote', case when kind = 'main' then null
                    else left(replace(content, E'\n', ' '), 160) end
    ) order by rrf desc)
    from top_seeds
  ), '[]'::jsonb),

  'surveys', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', node_id, 'label', label, 'statId', stat_id,
      'overview', description, 'score', round(score, 5),
      'paths', (select jsonb_agg(p) from (select p from jsonb_array_elements(paths) p limit 4) t)
    ) order by score desc)
    from ranked
  ), '[]'::jsonb),

  -- 통계개념과 정의. 조사 이름만 주면 "그래서 이 말이 뭔데" 가 남습니다.
  'concepts', coalesce((
    select jsonb_agg(x) from (
      select distinct jsonb_build_object(
        'label', c.label,
        'alt', c.alt_labels,
        'definition', c.description,
        'group', (select g.label from public.ontology_relations br
                  join public.ontology_entities g on g.id = br.target_id
                  where br.property_id = 'broaderConcept' and br.source_id = c.id limit 1),
        'surveys', (select jsonb_agg(distinct se.label)
                    from public.ontology_relations dr
                    join public.ontology_entities se on se.id = dr.source_id
                    where dr.property_id = 'definesConcept' and dr.target_id = c.id
                      and dr.source_id in (select node_id from ranked))
      ) as x
      from public.ontology_relations r
      join public.ontology_entities c on c.id = r.target_id and c.class_id = 'Concept'
      where r.property_id = 'definesConcept'
        and r.source_id in (select node_id from ranked)
        and coalesce(c.props->>'isGroup', 'false') = 'false'
      limit 10
    ) t
  ), '[]'::jsonb),

  -- 지표. "이 조사로 무엇을 볼 수 있나" 에 답합니다.
  'indicators', coalesce((
    select jsonb_agg(x) from (
      select distinct jsonb_build_object(
        'label', i.label,
        'unit', i.props->>'unit',
        'description', i.description,
        'note', i.props->>'note',
        'measuredBy', (select jsonb_agg(distinct se.label)
                       from public.ontology_relations mr
                       join public.ontology_entities se on se.id = mr.target_id
                       where mr.property_id = 'measuredBy' and mr.source_id = i.id)
      ) as x
      from public.ontology_relations r
      join public.ontology_entities i on i.id = r.source_id and i.class_id = 'Indicator'
      where r.property_id = 'measuredBy'
        and r.target_id in (select node_id from ranked)
      limit 10
    ) t
  ), '[]'::jsonb),

  -- 실제로 지나온 관계. 그래프를 탔다는 증거입니다.
  'relations', coalesce((
    select jsonb_agg(x) from (
      select distinct jsonb_build_object(
        'from', ea.label, 'fromClass', ea.class_id,
        'property', r.property_id,
        'propertyLabel', p.label,
        'to', eb.label, 'toClass', eb.class_id,
        'evidence', left(coalesce(r.evidence, ''), 200)
      ) as x
      from public.ontology_relations r
      join public.ontology_entities ea on ea.id = r.source_id
      join public.ontology_entities eb on eb.id = r.target_id
      left join public.ontology_properties p on p.id = r.property_id
      where (r.source_id in (select node_id from ranked) or r.target_id in (select node_id from ranked))
        and (r.source_id in (select entity_id from top_seeds)
             or r.target_id in (select entity_id from top_seeds)
             or r.property_id in ('oftenConfusedWith', 'coversLifeStage', 'measuredBy'))
      limit 40
    ) t
  ), '[]'::jsonb),

  'tables', coalesce((
    select jsonb_agg(x order by x->'score' desc) from (
      select jsonb_build_object(
        'label', e.label, 'orgId', e.props->>'orgId', 'tblId', e.props->>'tblId',
        'latestPeriod', e.props->>'latestPeriod', 'survey', se.label,
        'score', round((1 - (m.embedding <=> p_embedding))::numeric, 4)
      ) as x
      from public.ontology_relations r
      join public.ontology_entities e  on e.id = r.target_id and e.class_id = 'StatisticalTable'
      join public.ontology_entities se on se.id = r.source_id
      join public.ontology_embeddings m on m.entity_id = e.id and m.kind = 'main'
      where r.property_id = 'hasDistribution'
        and r.source_id in (select node_id from ranked)
      order by m.embedding <=> p_embedding
      limit 8
    ) t
  ), '[]'::jsonb),

  'cautions', coalesce((
    select jsonb_agg(distinct jsonb_build_object('a', ea.label, 'b', eb.label, 'why', r.evidence))
    from public.ontology_relations r
    join public.ontology_entities ea on ea.id = r.source_id
    join public.ontology_entities eb on eb.id = r.target_id
    where r.property_id = 'oftenConfusedWith'
      and r.source_id in (select node_id from ranked)
      and r.target_id in (select node_id from ranked)
  ), '[]'::jsonb)
);
$$;

grant execute on function public.graphrag_search(vector, text, text[], int, int) to anon, authenticated;

notify pgrst, 'reload schema';
