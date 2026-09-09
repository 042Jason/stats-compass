-- ============================================================================
-- 0004_ontology.sql — 통계나침반 온톨로지 그래프
--
-- 설계 문서: docs/ontology-design.md
-- 클래스·프로퍼티는 자체 어휘(stc:)로 두되 DCAT 3 / SKOS / RDF Data Cube(SDMX)
-- 대응 URI 를 std_uri 에 함께 저장한다. 나중에 JSON-LD·Turtle 로 내보낼 때 쓴다.
--
-- Supabase SQL Editor 에서 통째로 실행하면 된다. 여러 번 실행해도 안전하다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 스키마
-- ---------------------------------------------------------------------------

-- 클래스 (T-Box)
create table if not exists public.ontology_classes (
  id           text primary key,              -- 'Survey', 'Concept' ...
  label        text not null,
  description  text,
  std_prefix   text,                          -- 'dcat' | 'skos' | 'qb' | 'foaf'
  std_uri      text,                          -- 확인된 표준 URI. 없으면 NULL
  sdmx_note    text,                          -- SDMX 정보모델 대응 메모
  color        text,                          -- 시각화용 (CSS 색)
  sort_order   int  not null default 100,
  created_at   timestamptz not null default now()
);

-- 프로퍼티 (T-Box)
create table if not exists public.ontology_properties (
  id            text primary key,             -- 'producedBy', 'hasTheme' ...
  label         text not null,
  description   text,
  domain_class  text references public.ontology_classes(id) on delete set null,
  range_class   text references public.ontology_classes(id) on delete set null,
  std_prefix    text,
  std_uri       text,
  is_symmetric  boolean not null default false,   -- symmetric 은 PostgreSQL 예약어라 못 씁니다
  inverse_of    text,
  sort_order    int not null default 100,
  created_at    timestamptz not null default now()
);

-- 인스턴스 (A-Box)
create table if not exists public.ontology_entities (
  id            uuid primary key default gen_random_uuid(),
  class_id      text not null references public.ontology_classes(id) on delete cascade,
  key           text not null,                -- 클래스 안에서 유일한 슬러그
  label         text not null,                -- skos:prefLabel
  alt_labels    text[] not null default '{}', -- skos:altLabel (약어·구명칭)
  description   text,                         -- skos:definition / dct:description
  std_uri       text,                         -- 외부 표준 코드값 (예: EU frequency)
  statistic_id  uuid references public.statistics(id) on delete cascade,
  props         jsonb not null default '{}'::jsonb,
  weight        numeric not null default 1,   -- 시각화 노드 크기 (연결 수 등)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (class_id, key)
);

-- 관계 (A-Box)
create table if not exists public.ontology_relations (
  id           uuid primary key default gen_random_uuid(),
  property_id  text not null references public.ontology_properties(id) on delete cascade,
  source_id    uuid not null references public.ontology_entities(id) on delete cascade,
  target_id    uuid not null references public.ontology_entities(id) on delete cascade,
  weight       numeric not null default 1,
  evidence     text,                          -- 이 관계를 만든 근거 문장/규칙
  props        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (property_id, source_id, target_id),
  check (source_id <> target_id)
);

create index if not exists ontology_entities_class_idx   on public.ontology_entities (class_id);
create index if not exists ontology_entities_stat_idx    on public.ontology_entities (statistic_id);
create index if not exists ontology_entities_label_idx   on public.ontology_entities (label);
create index if not exists ontology_relations_src_idx    on public.ontology_relations (source_id);
create index if not exists ontology_relations_tgt_idx    on public.ontology_relations (target_id);
create index if not exists ontology_relations_prop_idx   on public.ontology_relations (property_id);

-- ---------------------------------------------------------------------------
-- 2. RLS — 공개 읽기, 쓰기는 service_role 만
-- ---------------------------------------------------------------------------

alter table public.ontology_classes    enable row level security;
alter table public.ontology_properties enable row level security;
alter table public.ontology_entities   enable row level security;
alter table public.ontology_relations  enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'ontology_classes','ontology_properties','ontology_entities','ontology_relations'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_read', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. 클래스 정의
-- ---------------------------------------------------------------------------

insert into public.ontology_classes (id, label, description, std_prefix, std_uri, sdmx_note, color, sort_order) values
  ('Catalog', '통계 카탈로그',
   '국가데이터처가 작성하는 국가승인통계 묶음 전체입니다.',
   'dcat', 'http://www.w3.org/ns/dcat#Catalog', null, '#6b7280', 10),

  ('Survey', '조사',
   'KOSIS 통계표 여러 개를 묶는 논리 단위입니다. 국가승인통계 한 건에 해당합니다.',
   'dcat', 'http://www.w3.org/ns/dcat#Dataset',
   'SDMX 정보모델의 Dataflow 묶음에 대응합니다.', '#2563eb', 20),

  ('StatisticalTable', '통계표',
   'KOSIS 통계표 한 개입니다. 현재는 클래스만 정의하고 인스턴스는 만들지 않습니다.',
   'dcat', 'http://www.w3.org/ns/dcat#Distribution',
   'RDF Data Cube 의 qb:DataSet 에 대응합니다.', '#93c5fd', 30),

  ('Agency', '작성기관',
   '통계를 작성하는 부서입니다.',
   'foaf', 'http://xmlns.com/foaf/0.1/Agent',
   'SDMX 의 Data Provider 에 대응합니다.', '#0f766e', 40),

  ('Theme', '주제분야',
   'KOSIS 주제 분류 15종입니다.',
   'skos', 'http://www.w3.org/2004/02/skos/core#Concept',
   'SDMX 의 Category Scheme 에 대응합니다.', '#7c3aed', 50),

  ('Concept', '통계개념',
   '통계를 읽을 때 알아야 하는 용어입니다. 주요 용어 설명에서 뽑았습니다.',
   'skos', 'http://www.w3.org/2004/02/skos/core#Concept',
   'SDMX 의 Concept(Concept Scheme 소속)에 대응합니다.', '#db2777', 60),

  ('Keyword', '주제어',
   '조사에 붙은 태그입니다. 자유 주제어이며 분류 체계는 아닙니다.',
   'skos', 'http://www.w3.org/2004/02/skos/core#Concept',
   null, '#ea580c', 70),

  ('Frequency', '작성주기',
   '통계를 얼마나 자주 작성하는지입니다.',
   'skos', 'http://www.w3.org/2004/02/skos/core#Concept',
   'EU Publications Office Frequency 코드값을 std_uri 에 붙였습니다.', '#ca8a04', 80),

  ('LegalBasis', '법적근거',
   '통계 작성의 근거가 되는 법령입니다.',
   null, null, null, '#475569', 90)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  std_prefix = excluded.std_prefix, std_uri = excluded.std_uri,
  sdmx_note = excluded.sdmx_note, color = excluded.color, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 4. 프로퍼티 정의
-- ---------------------------------------------------------------------------

insert into public.ontology_properties
  (id, label, description, domain_class, range_class, std_prefix, std_uri, is_symmetric, sort_order) values

  -- 조사에서 나가는 관계
  ('inCatalog', '카탈로그 소속', '이 조사가 담긴 카탈로그입니다.',
   'Survey', 'Catalog', 'dcat', 'http://www.w3.org/ns/dcat#dataset', false, 10),
  ('producedBy', '작성기관', '이 조사를 작성하는 부서입니다.',
   'Survey', 'Agency', 'dct', 'http://purl.org/dc/terms/publisher', false, 20),
  ('hasTheme', '주제분야', '이 조사가 속한 주제 분류입니다.',
   'Survey', 'Theme', 'dcat', 'http://www.w3.org/ns/dcat#theme', false, 30),
  ('hasKeyword', '주제어', '이 조사에 붙은 태그입니다.',
   'Survey', 'Keyword', 'dcat', 'http://www.w3.org/ns/dcat#keyword', false, 40),
  ('definesConcept', '정의하는 개념', '이 조사를 읽을 때 알아야 하는 용어입니다.',
   'Survey', 'Concept', 'skos', 'http://www.w3.org/2004/02/skos/core#member', false, 50),
  ('hasFrequency', '작성주기', '이 조사를 얼마나 자주 작성하는지입니다.',
   'Survey', 'Frequency', 'dct', 'http://purl.org/dc/terms/accrualPeriodicity', false, 60),
  ('basedOn', '법적근거', '이 조사의 작성 근거가 되는 법령입니다.',
   'Survey', 'LegalBasis', 'dct', 'http://purl.org/dc/terms/provenance', false, 70),

  -- 조사끼리 (추론)
  ('sharesConceptWith', '개념을 공유', '같은 용어를 쓰는 조사입니다. 가중치는 공유한 개념 수입니다.',
   'Survey', 'Survey', 'dct', 'http://purl.org/dc/terms/relation', true, 110),
  ('relatedTo', '주제가 비슷', '주제어와 주제분야가 겹치는 조사입니다.',
   'Survey', 'Survey', 'dct', 'http://purl.org/dc/terms/relation', true, 120),
  ('oftenConfusedWith', '혼동하기 쉬움', '유의사항에서 "서로 다르니 섞지 말라"고 짚은 조사입니다.',
   'Survey', 'Survey', 'dct', 'http://purl.org/dc/terms/relation', true, 130),
  ('complements', '함께 보면 좋음', '같은 큐레이션 세트에 함께 담긴 조사입니다.',
   'Survey', 'Survey', 'dct', 'http://purl.org/dc/terms/relation', true, 140),
  ('supersedes', '이전 통계를 대체', '명칭 변경이나 개편으로 이 조사가 대체한 통계입니다.',
   'Survey', 'Survey', 'dct', 'http://purl.org/dc/terms/replaces', false, 150),

  -- 개념끼리
  ('broaderConcept', '상위 개념', '이 개념이 속한 더 넓은 개념군입니다.',
   'Concept', 'Concept', 'skos', 'http://www.w3.org/2004/02/skos/core#broader', false, 210),
  ('relatedConcept', '관련 개념', '같은 조사에서 함께 설명되는 개념입니다.',
   'Concept', 'Concept', 'skos', 'http://www.w3.org/2004/02/skos/core#related', true, 220)
on conflict (id) do update set
  label = excluded.label, description = excluded.description,
  domain_class = excluded.domain_class, range_class = excluded.range_class,
  std_prefix = excluded.std_prefix, std_uri = excluded.std_uri,
  is_symmetric = excluded.is_symmetric, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 5. 조회 RPC
--
-- PostgREST 는 응답을 1,000행에서 자른다. 관계가 그보다 많으므로
-- 노드·엣지를 jsonb 한 행으로 묶어 돌려준다.
-- ---------------------------------------------------------------------------

create or replace function public.ontology_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'classes', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.sort_order)
      from public.ontology_classes c
    ), '[]'::jsonb),
    'properties', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.sort_order)
      from public.ontology_properties p
    ), '[]'::jsonb),
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'class', e.class_id, 'key', e.key, 'label', e.label,
        'alt', e.alt_labels, 'desc', e.description, 'stdUri', e.std_uri,
        'statId', s.stat_id, 'weight', e.weight, 'props', e.props
      ) order by e.class_id, e.label)
      from public.ontology_entities e
      left join public.statistics s on s.id = e.statistic_id
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'p', r.property_id, 's', r.source_id, 't', r.target_id,
        'w', r.weight, 'why', r.evidence
      ))
      from public.ontology_relations r
    ), '[]'::jsonb)
  );
$$;

-- 한 노드의 이웃만 가져오기 (상세 페이지 미니 그래프용)
create or replace function public.ontology_neighbors(p_entity uuid, p_limit int default 60)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with edges as (
    select r.property_id, r.source_id, r.target_id, r.weight, r.evidence
    from public.ontology_relations r
    where r.source_id = p_entity or r.target_id = p_entity
    order by r.weight desc
    limit p_limit
  ),
  ids as (
    select p_entity as id
    union select source_id from edges
    union select target_id from edges
  )
  select jsonb_build_object(
    'center', p_entity,
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'class', e.class_id, 'key', e.key, 'label', e.label,
        'desc', e.description, 'statId', s.stat_id, 'weight', e.weight
      ))
      from public.ontology_entities e
      join ids on ids.id = e.id
      left join public.statistics s on s.id = e.statistic_id
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'p', property_id, 's', source_id, 't', target_id, 'w', weight, 'why', evidence
      )) from edges
    ), '[]'::jsonb)
  );
$$;

-- 조사 stat_id 로 해당 Survey 노드를 찾아 이웃까지 한 번에
create or replace function public.ontology_for_statistic(p_stat_id text, p_limit int default 60)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.ontology_neighbors(e.id, p_limit)
  from public.ontology_entities e
  join public.statistics s on s.id = e.statistic_id
  where e.class_id = 'Survey' and s.stat_id = p_stat_id
  limit 1;
$$;

grant execute on function public.ontology_snapshot()                  to anon, authenticated;
grant execute on function public.ontology_neighbors(uuid, int)        to anon, authenticated;
grant execute on function public.ontology_for_statistic(text, int)    to anon, authenticated;

notify pgrst, 'reload schema';
