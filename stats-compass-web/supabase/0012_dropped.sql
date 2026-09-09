-- ============================================================================
-- 0012_dropped.sql — 탈락 후보 노출 (그래프 뷰용)
--
-- 0011_perf.sql 다음에 실행합니다. 0011 의 성능 개선을 모두 포함합니다. (함수 전체를 다시 정의합니다)
--
-- 증상
--   시드 스크립트(service_role)에서는 되는데 웹앱(anon)에서만 이렇게 죽습니다.
--     [supabase] canceling statement due to statement timeout
--   Supabase 는 anon 역할의 statement_timeout 을 3초로 둡니다.
--   service_role 은 제한이 없어 개발 중엔 안 보이다가 화면에서만 터집니다.
--
-- 무엇이 느렸나 — 셋 다 통계표가 953개에서 6,433개로 늘면서 생긴 일입니다.
--   1) tbl  — 조사 8곳의 모든 표에 거리를 구한 뒤 전체 정렬
--   2) relations — hasDistribution 6,433건이 distinct 대상에 섞임
--   3) 인덱스 — (source_id, property_id) 복합 인덱스가 없어 한쪽만 타고 필터
-- ============================================================================

-- ① 복합 인덱스. tbl 이 정확히 이 두 컬럼으로 찾습니다.
create index if not exists ontology_relations_src_prop_idx
  on public.ontology_relations (source_id, property_id);
create index if not exists ontology_relations_tgt_prop_idx
  on public.ontology_relations (target_id, property_id);

-- ② 임베딩을 entity_id + kind 로 집어내는 경로.
create index if not exists ontology_embeddings_entity_kind_idx
  on public.ontology_embeddings (entity_id, kind);

analyze public.ontology_relations;
analyze public.ontology_embeddings;

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
-- anon 역할의 기본 제한은 3초입니다. 이 함수에만 여유를 줍니다.
-- 정상이면 1초 안에 끝나야 하고, 이 값은 사고를 막는 안전망입니다.
set statement_timeout = '20s'
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
  -- 조사 씨앗이 자기 통계표 수백 개로 뻗는 것을 막습니다.
  -- 어차피 아래 ranked 가 class_id='Survey' 만 남기므로 전부 버려지는 일입니다.
  -- 반대 방향(통계표 씨앗 → 그 조사)은 쓸모가 있으니 그대로 둡니다.
  where not (r.property_id = 'hasDistribution' and r.source_id = s.entity_id)
),
stage_ok as (
  select distinct r.source_id as survey_id
  from public.ontology_relations r
  join public.ontology_entities st on st.id = r.target_id
  where r.property_id = 'coversLifeStage'
    and (p_stages is null or st.key = any(p_stages))
),
-- 점수는 매기되 자르지 않습니다. 잘린 것들이 아래 dropped 가 됩니다.
ranked_all as (
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
),
ranked as (
  select * from ranked_all order by score desc limit p_limit
),
-- 후보까지 갔다가 밀린 조사들. 그래프에서 흐리게 그려 "무엇을 안 골랐는지" 를 보여 줍니다.
-- 채택된 조사와 oftenConfusedWith 로 묶여 있으면 그 상대를 함께 실어 보냅니다.
-- (주의: 이 관계가 탈락의 <원인>은 아닙니다. 점수로 밀린 것이고, 혼동쌍이라는 사실을
--  덧붙일 뿐입니다. 화면 문구도 그렇게 써야 합니다.)
dropped as (
  select ra.node_id, ra.label, ra.score,
         (select eb.label
            from public.ontology_relations r
            join public.ontology_entities eb
              on eb.id = case when r.source_id = ra.node_id then r.target_id else r.source_id end
           where r.property_id = 'oftenConfusedWith'
             and (r.source_id = ra.node_id or r.target_id = ra.node_id)
             and (case when r.source_id = ra.node_id then r.target_id else r.source_id end)
                 in (select node_id from ranked)
           limit 1) as confused_with
  from ranked_all ra
  where ra.node_id not in (select node_id from ranked)
  order by ra.score desc
  limit 8
),
-- 조사별 상위 2개만 뽑습니다.
--
--   0010 까지는 랭킹된 조사 8곳의 <모든> 통계표에 대해 거리를 구한 뒤
--   전체를 정렬했습니다. 통계표가 953개일 땐 견뎠지만 6,433개가 되자
--   anon 역할의 3초 제한을 넘겼습니다.
--
--   LATERAL 로 조사마다 따로 상위 2개를 가져오면 정렬 대상이 조사 단위로
--   쪼개지고, (source_id, property_id) 복합 인덱스가 그 조사의 표만 집어냅니다.
tbl as (
  select rk.node_id, rk.score as survey_score, rk.label as survey_label,
         t.label, t.props, t.tsim, t.rn_in_survey
  from ranked rk
  cross join lateral (
    select e.label, e.props,
           (1 - (m.embedding <=> p_embedding))::numeric as tsim,
           row_number() over (order by m.embedding <=> p_embedding) as rn_in_survey
    from public.ontology_relations r
    join public.ontology_entities e   on e.id = r.target_id
    join public.ontology_embeddings m on m.entity_id = e.id and m.kind = 'main'
    where r.source_id = rk.node_id
      and r.property_id = 'hasDistribution'
    order by m.embedding <=> p_embedding
    limit 2
  ) t
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

  'dropped', coalesce((
    select jsonb_agg(jsonb_build_object(
      'label', label, 'score', round(score, 5), 'confusedWith', confused_with
    ) order by score desc)
    from dropped
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
      -- hasDistribution 은 6,433건이라 여기 들어오면 distinct 비용이 폭발합니다.
      -- 통계표는 아래 'tables' 가 따로 보여 주므로 관계 목록에서는 뺍니다.
      where r.property_id <> 'hasDistribution'
        and (r.source_id in (select node_id from ranked) or r.target_id in (select node_id from ranked))
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
