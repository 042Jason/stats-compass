# 통계나침반 온톨로지 설계

작성 2026-09-09 · 대상 범위: 조사 69건 + 개념 + 기관 (통계표 11,163건은 확장 지점으로만 정의)

## 0. 설계 원칙

1. **자체 어휘 + 표준 매핑.** 노드·관계는 우리 도메인에 맞춘 `stc:` 어휘로 정의하되,
   모든 클래스·프로퍼티에 DCAT 3 / SKOS / RDF Data Cube(SDMX) 대응 URI를 붙여 둔다.
   Supabase 를 정본으로 두고, 나중에 JSON-LD·Turtle 로 내보낼 때 매핑을 그대로 쓴다.
2. **탐색 우선.** 1차 목적이 "이 조사와 비슷한 건?", "이 개념을 다루는 통계는?" 이므로
   허브 노드(개념·주제어·기관)가 조사들을 이어 주도록 설계한다.
3. **추측한 URI 는 쓰지 않는다.** 확인되지 않은 표준 용어는 `std_uri` 를 NULL 로 둔다.

## 1. 네임스페이스

| prefix | URI | 용도 |
|---|---|---|
| `stc` | `https://stats-compass.kr/def/` | 자체 어휘(클래스·프로퍼티) |
| `stcr` | `https://stats-compass.kr/id/` | 자체 인스턴스 |
| `dcat` | `http://www.w3.org/ns/dcat#` | 카탈로그·데이터셋 |
| `dct` | `http://purl.org/dc/terms/` | 서술 메타데이터 |
| `skos` | `http://www.w3.org/2004/02/skos/core#` | 개념 체계 |
| `qb` | `http://purl.org/linked-data/cube#` | RDF Data Cube (SDMX 구조) |
| `sdmx` | `http://purl.org/linked-data/sdmx#` | SDMX-RDF |
| `foaf` | `http://xmlns.com/foaf/0.1/` | 기관 |
| `freq` | `http://publications.europa.eu/resource/authority/frequency/` | 주기 코드 |

> DCAT-AP 최신 확정본은 3.0.1(2024). 국내 응용 프로파일로 DCAT-AP-KR 2.1.0 이 있고
> 주기는 EU frequency authority table 을 그대로 쓴다. 우리도 같은 코드값을 쓴다.

## 2. 클래스

| stc 클래스 | 라벨 | 인스턴스 수(예상) | DCAT / SKOS | SDMX 대응 |
|---|---|---|---|---|
| `stc:Catalog` | 통계 카탈로그 | 1 | `dcat:Catalog` | — |
| `stc:Survey` | 조사(국가승인통계) | 69 | `dcat:Dataset` (시계열 묶음이므로 `dcat:DatasetSeries` 성격 겸함) | Dataflow 에 대응 |
| `stc:StatisticalTable` | 통계표 | (미인스턴스화, 11,163) | `dcat:Distribution` | `qb:DataSet` |
| `stc:Agency` | 작성기관 | ~40 | `foaf:Agent` (`dct:publisher` 의 값) | Data Provider |
| `stc:Theme` | 주제분야 | 15 | `skos:Concept` (`dcat:themeTaxonomy` 소속) | Category Scheme |
| `stc:Concept` | 통계개념(주요 용어) | ~300 | `skos:Concept` | Concept (Concept Scheme 소속) |
| `stc:Keyword` | 주제어(태그) | ~150 | `dcat:keyword` 를 노드화한 `skos:Concept` | — |
| `stc:Frequency` | 작성주기 | ~7 | `dct:accrualPeriodicity` 의 값 | `freq` 코드리스트 |
| `stc:LegalBasis` | 법적근거 | ~30 | `dct:provenance` 대상 | — |

`stc:Survey` 를 `dcat:Dataset` 으로 잡은 이유: 우리의 "조사" 는 KOSIS 통계표 여러 개를 묶는
논리 단위다. DCAT 에서 배포 단위는 `dcat:Distribution`(=통계표), 논리 단위는 `dcat:Dataset` 이다.
SDMX 로 보면 DSD 를 공유하는 Dataflow 묶음에 가깝다.

## 3. 프로퍼티

### 3.1 조사에서 나가는 관계

| stc 프로퍼티 | 도메인 → 치역 | 표준 매핑 | 근거 필드 |
|---|---|---|---|
| `stc:producedBy` | Survey → Agency | `dct:publisher` | `statistics.agency` |
| `stc:hasTheme` | Survey → Theme | `dcat:theme` | `statistics.category` |
| `stc:hasKeyword` | Survey → Keyword | `dcat:keyword` | `statistics.tags` |
| `stc:definesConcept` | Survey → Concept | `skos:member` (역방향 `skos:inScheme` 성격) | `ai_content.terms` |
| `stc:hasFrequency` | Survey → Frequency | `dct:accrualPeriodicity` | `statistics.frequency` |
| `stc:basedOn` | Survey → LegalBasis | `dct:provenance` | `raw_meta` 법적근거 |
| `stc:inCatalog` | Survey → Catalog | `dcat:dataset` 의 역 | 고정 |

### 3.2 조사끼리의 관계 (추론)

| stc 프로퍼티 | 성격 | 표준 매핑 | 도출 방법 |
|---|---|---|---|
| `stc:sharesConceptWith` | 대칭 | `dct:relation` | 공유 개념 수 ≥1, 가중치 = 공유 수 |
| `stc:relatedTo` | 대칭 | `dct:relation` | 주제어·주제분야 자카드 유사도 ≥ 임계값 |
| `stc:oftenConfusedWith` | 대칭 | `dct:relation` (하위) | 유의사항 문장에서 "A 와 다릅니다/혼동/≠" 패턴 추출 |
| `stc:complements` | 대칭 | `dct:relation` | 같은 큐레이션 세트에 함께 담김 |
| `stc:supersedes` | 비대칭 | `dct:replaces` | 명칭의 "(구. ○○)" 표기, 개편 이력 |

`stc:oftenConfusedWith` 가 이 온톨로지의 핵심 자산이다. 유의사항 374문장 중 94문장이
"다른 통계와 혼동하지 말라" 는 취지이며, 이는 KOSIS 원문에도 정리돼 있지 않은 관계다.

### 3.3 개념끼리의 관계

| stc 프로퍼티 | 표준 매핑 | 도출 방법 |
|---|---|---|
| `stc:broaderConcept` | `skos:broader` | 개념군(표본·오차 / 지수·기준연도 / 행정자료 / 계절조정 / 인구 / 가구·사업체 …) 수작업 분류 |
| `stc:relatedConcept` | `skos:related` | 같은 조사에서 함께 정의된 개념쌍(동시출현) |

## 4. 저장 스키마 (Supabase)

```
ontology_classes    (id, label, description, std_uri, std_prefix, color, sort_order)
ontology_properties (id, label, domain_class, range_class, std_uri, symmetric, inverse_of, description)
ontology_entities   (id, class_id, key, label, alt_labels[], description, std_uri, statistic_id, props, weight)
ontology_relations  (id, property_id, source_id, target_id, weight, evidence, props)
```

- `ontology_entities.statistic_id` 는 `stc:Survey` 인스턴스에서만 채워져 기존 상세 페이지로 이어 준다.
- `alt_labels` 는 `skos:altLabel`(약어·구명칭)을 담는다. 검색 재현율에 쓴다.
- 조회는 RPC `ontology_snapshot()` 이 노드·엣지를 **jsonb 한 행**으로 반환한다.
  PostgREST 가 응답을 1,000행으로 자르기 때문에 관계를 행 단위로 받으면 안 된다.

## 5. 개념 정규화 규칙

원본 용어 328개(고유 303개)는 그대로 쓰면 대부분 조사 한 개에만 붙어 허브가 되지 못한다.
다음 규칙으로 정리한다.

1. **복합 용어 분해** — "원지수와 계절조정지수", "기업체와 사업체", "명목과 실질" 처럼
   `A와 B` / `A 대 B` 형태는 두 개념으로 쪼갠다.
2. **괄호 약어 분리** — "상대표준오차(RSE)" → prefLabel `상대표준오차`, altLabel `RSE`.
3. **동의어 병합** — 표기만 다른 것(띄어쓰기·조사·수식어)을 하나로 모으고 나머지는 altLabel.
4. **상위 개념 부여** — 방법론 개념군 8~10개를 만들어 `skos:broader` 로 묶는다.
   개별 개념이 조사 하나에만 걸려도 상위 개념을 통해 다른 조사로 이어진다.

## 6. 확장 지점

- **통계표 계층**: `stc:StatisticalTable` 을 인스턴스화하면 `dcat:Distribution` 이 채워지고
  `qb:DataSet` 으로 내보낼 수 있다. 다만 노드가 1.1만 개로 늘어 시각화 전략이 달라진다.
- **분류·항목 계층**: KOSIS 통계표 메타의 분류(objL)를 수집하면 `qb:DimensionProperty` 와
  `skos:ConceptScheme`(코드리스트)까지 내려갈 수 있다. 추가 수집이 필요하다.
- **내보내기**: `ontology_classes/properties` 의 `std_uri` 를 그대로 써서
  JSON-LD context 를 만들고 노드·엣지를 직렬화하면 DCAT/SKOS 호환 파일이 나온다.
