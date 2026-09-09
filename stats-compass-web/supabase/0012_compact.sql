create index if not exists ontology_relations_src_prop_idx
on public.ontology_relations (source_id, property_id);
create index if not exists ontology_relations_tgt_prop_idx
on public.ontology_relations (target_id, property_id);
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
p_want_region boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
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
where not (r.property_id = 'hasDistribution' and r.source_id = s.entity_id)
),
stage_ok as (
select distinct r.source_id as survey_id
from public.ontology_relations r
join public.ontology_entities st on st.id = r.target_id
where r.property_id = 'coversLifeStage'
and (p_stages is null or st.key = any(p_stages))
),
ranked_all as (
select h.node_id, e.label, s.stat_id, e.description,
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
where r.property_id <> 'hasDistribution'
and (r.source_id in (select node_id from ranked) or r.target_id in (select node_id from ranked))
and (r.source_id in (select entity_id from top_seeds)
or r.target_id in (select entity_id from top_seeds)
or r.property_id in ('oftenConfusedWith', 'coversLifeStage', 'measuredBy'))
limit 40
) t
), '[]'::jsonb),
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
