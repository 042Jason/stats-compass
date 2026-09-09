-- ============================================================================
-- 0007_dimensions.sql — 지역 · 연령대 · 성별 클래스
--
-- 0005_lifecourse.sql 다음에 실행합니다. (0006 과는 서로 독립입니다)
--
-- 왜 필요한가
--   "대전 사는 35살 남자" 를 처리하려면 대전→코드, 35살→연령대→생애단계 로
--   옮기는 단계가 필요합니다. 지금은 이게 코드에 하드코딩돼 있어
--   바꾸려면 배포를 해야 합니다. 데이터로 옮깁니다.
--
-- 설계상 유의
--   통계표마다 지역·연령·성별을 관계로 걸면 1,386 × 17 = 2만 3천 건이 생기는데
--   얻는 게 없습니다. 지역 지원 여부는 통계표 <속성>(props.regionLevel)으로 두고,
--   Region 노드는 <질의 슬롯 해석>에만 씁니다.
-- ============================================================================

-- 전제조건 확인 — 0005 를 먼저 돌리지 않으면 아래 FK 에서 알아보기 어려운 오류가 납니다.
do $$
begin
  if not exists (select 1 from public.ontology_classes where id = 'LifeStage') then
    raise exception
      'LifeStage 클래스가 없습니다. 0005_lifecourse.sql 을 먼저 실행하세요. (실행 순서: 0004 → 0005 → 0006 → 0007)';
  end if;
end $$;

insert into public.ontology_classes (id, label, description, std_prefix, std_uri, sdmx_note, color, sort_order) values
  ('Region', '지역',
   '시도 단위 행정구역입니다. 질의의 지역 표현을 코드로 옮기는 데 씁니다.',
   'dct', 'http://purl.org/dc/terms/Location',
   'SDMX 의 REF_AREA 차원에 대응합니다.', '#0d9488', 12),

  ('AgeBand', '연령대',
   '통계표에서 흔히 쓰는 연령 구간입니다. 나이를 생애단계로 옮기는 다리가 됩니다.',
   'skos', 'http://www.w3.org/2004/02/skos/core#Concept',
   'SDMX 의 AGE 차원에 대응합니다.', '#7c3aed', 13),

  ('Sex', '성별',
   '통계표의 성별 분류값입니다.',
   'skos', 'http://www.w3.org/2004/02/skos/core#Concept',
   'SDMX 의 SEX 차원에 대응합니다.', '#be185d', 14),

  ('MaritalStatus', '혼인상태',
   '미혼·유배우·사별·이혼 분류입니다. 값에 따라 소득·부채가 크게 달라져, 비어 있으면 되묻는 대상이 됩니다.',
   'skos', 'http://www.w3.org/2004/02/skos/core#Concept',
   'SDMX 의 MARITAL_STATUS 차원에 대응합니다.', '#9a3412', 15)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  std_prefix = excluded.std_prefix, std_uri = excluded.std_uri,
  sdmx_note = excluded.sdmx_note, color = excluded.color, sort_order = excluded.sort_order;

insert into public.ontology_properties
  (id, label, description, domain_class, range_class, std_prefix, std_uri, is_symmetric, sort_order) values

  ('narrowerRegion', '하위 지역', '전국 아래의 시도입니다.',
   'Region', 'Region', 'skos', 'http://www.w3.org/2004/02/skos/core#narrower', false, 12),

  ('stageForAge', '해당 생애단계', '이 연령대가 걸치는 생애단계입니다. 나이→단계 규칙을 데이터로 둔 것입니다.',
   'AgeBand', 'LifeStage', 'skos', 'http://www.w3.org/2004/02/skos/core#related', false, 13)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  domain_class = excluded.domain_class, range_class = excluded.range_class,
  std_prefix = excluded.std_prefix, std_uri = excluded.std_uri,
  is_symmetric = excluded.is_symmetric, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 질의 슬롯 해석용 조회 함수
--
--   지역 표현 → Region 노드 (별칭 포함 매칭)
--   나이      → AgeBand → LifeStage
-- ---------------------------------------------------------------------------

create or replace function public.resolve_region(p_text text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x->>'score' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'code', e.key, 'label', e.label, 'level', e.props->>'level',
      'matched', case when e.label = p_text then e.label
                      else (select a from unnest(e.alt_labels) a
                            where p_text like '%' || a || '%' limit 1) end,
      'score', case when e.label = p_text then 1.0
                    when p_text like '%' || e.label || '%' then 0.95
                    else 0.9 end
    ) as x
    from public.ontology_entities e
    where e.class_id = 'Region'
      and (e.label = p_text
           or p_text like '%' || e.label || '%'
           or exists (select 1 from unnest(e.alt_labels) a where p_text like '%' || a || '%'))
    limit 5
  ) t;
$$;

create or replace function public.resolve_age(p_age int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with band as (
    select e.id, e.key, e.label, e.props
    from public.ontology_entities e
    where e.class_id = 'AgeBand'
      and (e.props->>'from')::int <= p_age
      and (e.props->>'to')::int   >= p_age
      -- 10세 구간을 우선하고 집계 구간(15~64세 등)은 뒤로 보냅니다
      order by ((e.props->>'to')::int - (e.props->>'from')::int) asc
  )
  select jsonb_build_object(
    'bands', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label)) from band), '[]'::jsonb),
    'stages', coalesce((
      select jsonb_agg(distinct jsonb_build_object('key', ls.key, 'label', ls.label))
      from band b
      join public.ontology_relations r on r.source_id = b.id and r.property_id = 'stageForAge'
      join public.ontology_entities ls on ls.id = r.target_id
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.resolve_region(text) to anon, authenticated;
grant execute on function public.resolve_age(int)     to anon, authenticated;

notify pgrst, 'reload schema';
