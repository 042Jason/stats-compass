-- ============================================================================
-- 0010_table_fairness.sql — 통계표 라운드로빈 배분
--
-- 0009_table_diversity.sql 다음에 실행합니다. (함수 전체를 다시 정의합니다)
--
-- 무엇이 문제였나
--   0009 에서 "조사당 최대 2개" 로 끊었지만, 정렬이 점수순 한 줄이라
--   상위 5개 조사가 2개씩 가져가면 거기서 10칸이 끝났습니다.
--   6~8위 조사는 통계표가 0개였습니다.
--
--   실제로 검증에서 이렇게 나왔습니다.
--     · 시나리오 1 — 일자리행정통계·주택소유통계를 <조사로는> 찾았는데 표가 없음
--     · 시나리오 2 — 조사 4/4 만점인데 국민이전계정 표가 없음
--
--   나침반의 본체는 "통계표ID 를 KOSIS 로 넘기는 것" 입니다.
--   조사를 찾고도 ID 를 못 넘기면 그 조사는 없는 것과 같습니다.
--
-- 어떻게 고치는가
--   정렬 키를 (rn_in_survey, 점수) 로 둡니다.
--   → 각 조사의 1등 표가 먼저 자리를 잡고(조사 8개면 8칸),
--     남는 자리를 2등 표들이 점수순으로 채웁니다.
--   상한은 10 → 12. 조사 8개 × 1개 + 여유 4칸입니다.
--
--   표를 고르는 기준(질의 벡터와의 거리)과 조사 랭킹은 그대로입니다.
--   바뀌는 건 <자리를 나눠주는 순서> 뿐입니다.
-- ============================================================================

create or replace function public.graphrag_search(
  p_embedding   vector(1536),
  p_query       text    default null,
  p_stages      text[]  default null,
  p_seed_k      int     default 16,
  p_limit       int     default 8,
  p_want_region boolean default false   -- 질의에 지역 슬롯이 잡혔는가
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
with
vec as (
  select m.id, m.entity_id, m.kind, m.field, m.content,
         (1 - (m.embedding <=> p_embedding))::numeric as sim,
         row_number() over (order by m.embedding <=> p_embedding) as rnk
  from public.ontology_embeddings m
  order by m.embedding <=> p_embedding
  limit p_seed_k * 3
),
lex as (
  select m.id, m.entity_id, m.kind, m.field, m.content,
         greatest(word_similarity(m.content, p_query), similarity(m.content, p_query))::numeric as sim,
         row_number() over (
           order by greatest(word_similarity(m.content, p_query), similarity(m.content, p_query)) desc
         ) as rnk
  from public.ontology_embeddings m
  where p_query is not null
    and length(p_query) >= 2
    and (m.content <% p_query or m.content % p_query)
    and greatest(word_similarity(m.content, p_query), similarity(m.content, p_query)) >= 0.45
  order by 6 desc
  limit p_seed_k * 3
),
fused as (
  select id, entity_id, kind, field, content, max(sim) as sim, sum(1.0 / (60 + rnk)) as rrf
  from (
    select id, entity_id, kind, field, content, sim, rnk from vec
    union all
    select id, entity_id, kind, field, content, sim, rnk from lex
  ) u
  group by id, entity_id, kind, field, content
),
seeds as (
  select distinct on (f.entity_id)
         f.entity_id, f.kind, f.field, f.content, f.sim, f.rrf, e.class_id, e.label
  from fused f
  join public.ontology_entities e on e.id = f.entity_id
  order by f.entity_id, f.rrf desc
),
top_seeds as (
  select * from seeds order by rrf desc limit p_seed_k
),
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
            when 'coversLifeStage'    then 0.40
            when 'hasTheme'           then 0.35
            else 0.30
          end)::numeric
  from top_seeds s
  join public.ontology_relations r on (r.source_id = s.entity_id or r.target_id = s.entity_id)
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
         -- 지역을 물었으면 지역 단위가 있는 조사를 우대합니다.
         sum(h.rrf * h.decay) *
         (case
            when not p_want_region then 1.0
            when e.props->>'regionLevel' = '시군구' then 1.35
            when e.props->>'regionLevel' = '시도'   then 1.20
            when e.props->>'regionLevel' = '전국만' then 0.85
            else 1.0
          end)::numeric as score,
         jsonb_agg(jsonb_build_object(
           'from', h.seed_label, 'fromClass', h.seed_class,
           'via', h.property_id, 'sim', round(h.sim, 3), 'why', h.evidence
         ) order by h.rrf * h.decay desc) as paths
  from hop h
  join public.ontology_entities e on e.id = h.node_id and e.class_id = 'Survey'
  left join public.statistics s on s.id = e.statistic_id
  where (p_stages is null or h.node_id in (select survey_id from stage_ok))
  group by h.node_id, e.label, s.stat_id, e.description, e.props
  order by score desc
  limit p_limit
),
-- 조사별로 표에 순번을 매깁니다. 순번 기준은 질의 벡터와의 거리입니다.
tbl as (
  select rk.node_id, rk.score as survey_score, rk.label as survey_label,
         e.label, e.props,
         (1 - (m.embedding <=> p_embedding))::numeric as tsim,
         row_number() over (
           partition by rk.node_id
           order by m.embedding <=> p_embedding
         ) as rn_in_survey
  from ranked rk
  join public.ontology_relations r on r.source_id = rk.node_id and r.property_id = 'hasDistribution'
  join public.ontology_entities e  on e.id = r.target_id
  join public.ontology_embeddings m on m.entity_id = e.id and m.kind = 'main'
)
select jsonb_build_object(

  'seeds', coalesce((
    select jsonb_agg(jsonb_build_object(
      'label', label, 'class', class_id, 'kind', kind, 'field', field,
      'sim', round(sim, 3),
      'quote', case when kind = 'main' then null else left(replace(content, E'\n', ' '), 160) end
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

  'concepts', coalesce((
    select jsonb_agg(x) from (
      select distinct jsonb_build_object(
        'label', c.label, 'alt', c.alt_labels, 'definition', c.description,
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

  'indicators', coalesce((
    select jsonb_agg(x) from (
      select distinct jsonb_build_object(
        'label', i.label, 'unit', i.props->>'unit',
        'description', i.description, 'note', i.props->>'note',
        'measuredBy', (select jsonb_agg(distinct se.label)
                       from public.ontology_relations mr
                       join public.ontology_entities se on se.id = mr.target_id
                       where mr.property_id = 'measuredBy' and mr.source_id = i.id)
      ) as x
      from public.ontology_relations r
      join public.ontology_entities i on i.id = r.source_id and i.class_id = 'Indicator'
      where r.property_id = 'measuredBy' and r.target_id in (select node_id from ranked)
      limit 10
    ) t
  ), '[]'::jsonb),

  'relations', coalesce((
    select jsonb_agg(x) from (
      select distinct jsonb_build_object(
        'from', ea.label, 'fromClass', ea.class_id,
        'property', r.property_id, 'propertyLabel', p.label,
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

  -- ▼ 0010 에서 바뀐 곳 ─────────────────────────────────────────────
  --   정렬 키가 (rn, 점수) 입니다. 각 조사의 1등 표가 먼저 자리를 잡습니다.
  --   'rank' 를 같이 실어 보내 프런트에서 "조사별 대표표" 를 구분할 수 있게 했습니다.
  'tables', coalesce((
    select jsonb_agg(x order by rn, sc desc) from (
      select jsonb_build_object(
               'label', label, 'orgId', props->>'orgId', 'tblId', props->>'tblId',
               'latestPeriod', props->>'latestPeriod', 'survey', survey_label,
               'rank', rn_in_survey,
               'score', round((survey_score * tsim)::numeric, 6)
             ) as x,
             rn_in_survey as rn,
             (survey_score * tsim)::numeric as sc
      from tbl
      where rn_in_survey <= 2
      order by rn_in_survey, survey_score * tsim desc
      limit 12
    ) t
  ), '[]'::jsonb),
  -- ▲ ───────────────────────────────────────────────────────────────

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
$fn$;

grant execute on function public.graphrag_search(vector, text, text[], int, int, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
