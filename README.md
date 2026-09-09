# 생애나침반

**조사 이름을 몰라도 통계를 찾을 수 있게 하는 GraphRAG 검색.**

> "대전 사는 35살 남잔데, 또래들 월급 얼마나 받는지, 집 살 때 빚은 얼마나 지는지 궁금해요"

이 한 문장에서 나이·지역·성별을 떼어내고, 온톨로지를 타고 참고할 국가승인통계와
통계표를 찾아, **왜 그것인지 경로까지** 보여 줍니다. 숫자는 KOSIS 공유서비스에서
직접 받아옵니다.

---

## 왜 만들었나

국가승인통계는 1,600여 종입니다. 그런데 연구자가 막히는 지점은 자료의 부족이 아니라
**이름**입니다.

- "월급"을 알고 싶은데 조사 이름은 `일자리행정통계` 입니다
- `가계동향조사` 와 `가계금융복지조사` 는 이름이 비슷한데 섞어 쓰면 안 됩니다
- 대전 값이 있는 조사인지 아닌지는 KOSIS 어디에도 정리돼 있지 않습니다

키워드 검색으로는 셋 다 안 풀립니다. 조사 이름을 이미 알아야 검색이 되기 때문입니다.
그래서 **의미로 잇는 그래프**를 깔고 그 위에서 검색합니다.

---

## 어떻게 동작하나

```
질문
 ├─① 슬롯 해석      나이 35 → 30~39세 → 생애단계 4개 · "대전" → 대전광역시(30)
 │                  regionText 는 정규식이 아니라 Region 노드 별칭과 대조합니다
 │
 ├─② 하이브리드 검색  어휘(pg_trgm) + 벡터(pgvector) 를 RRF 로 합산
 │                  "월급 얼마" 같은 짧은 별칭은 어휘로만 잡힙니다 (벡터로는 0.4대)
 │                  "또래들은 어떻게 사는지" 같은 표현은 벡터로만 잡힙니다
 │
 ├─③ 그래프 확장     Indicator ─measuredBy→ Survey
 │                  LifeStage ←coversLifeStage─ Survey
 │                  관계마다 감쇠계수를 달리 줍니다 (answeredBy 0.95 … hasTheme 0.35)
 │
 ├─④ 가지치기        지역을 물었으면 시군구 단위 조사에 가산점(×1.35)
 │                  oftenConfusedWith 로 묶인 쌍은 경고로 함께 표시
 │
 └─⑤ 통계표          조사마다 대표표를 하나씩 먼저 배정하고 남는 자리를 채웁니다
                    → orgId / tblId 를 KOSIS 로 넘겨 실제 수치를 받아옵니다
```

**나침반은 통계표ID까지만 찾습니다.** 숫자의 출처는 KOSIS입니다. 그 경계를 화면에서도
지킵니다.

---

## 온톨로지

`ontology_classes` / `ontology_properties` / `ontology_entities` / `ontology_relations`
네 테이블에 T-Box 와 A-Box 를 나눠 담았습니다. **DCAT 3 · SKOS · RDF Data Cube · SDMX**
어휘에 맞춰 설계했습니다.

| 클래스 | 수 | 표준 매핑 |
|---|---|---|
| `Survey` 조사 | 69 | `dcat:Dataset` |
| `StatisticalTable` 통계표 | 6,433 | `dcat:Distribution` / `qb:DataSet` |
| `Concept` 통계용어 | 313 | `skos:Concept` |
| `Indicator` 핵심지표 | 47 | `qb:MeasureProperty` |
| `LifeStage` 생애단계 | 9 | `skos:Concept` |
| `Region` · `AgeBand` · `Sex` · `MaritalStatus` | 40 | SDMX `REF_AREA` · `AGE` · `SEX` |
| 그 밖에 `Catalog` `Agency` `Theme` `Keyword` `Frequency` `LegalBasis` `ResearchQuestion` `NewsArticle` | | |

노드 7,356개 · 관계 8,887개.

**서명 자산은 `oftenConfusedWith` 입니다.** 통계설명자료의 이용시 유의사항 374개 문장에서
"○○와 혼동하지 말 것" 패턴을 뽑아 만든 30쌍입니다. 사람이 정리한 적 없는 관계입니다.

`regionLevel`(시군구 8 / 시도 12 / 전국만 7)도 통계표 제목에서 자동 판정했습니다.
"이 조사에 대전 값이 있나"를 계산으로 답합니다.

---

## 검증

`src/seed/16_checkScenarios.ts` 가 시연 시나리오 둘을 실제로 검색시켜 채점합니다.

```
━━ 35세 · 남성 · 대전 — 또래 월급과 주거 부채
   기대 조사 3/3 (100%) ✓      기대 통계표(조사 단위) 3/3 (100%) ✓
━━ 50대 — 은퇴 후 필요자금
   기대 조사 4/4 (100%) ✓      기대 통계표(조사 단위) 4/4 (100%) ✓
OK 종합 적중 14/14 (100%)
```

**이 숫자를 정확히 읽어 주세요.** "질문에 맞는 **조사**를 찾는 정확도"가 100%이고,
그 조사의 표 중 벡터 유사도 상위 2개를 넘깁니다. 사람이 미리 찍어둔 바로 그 통계표가
1등으로 오는 비율(정확한 tblId 일치)은 0/3, 1/4 로 훨씬 낮습니다. 한 조사에 표가
수백 개라 "정답이 하나"인 문제가 아니기 때문입니다.

---

## 구조

```
├── src/seed/              시드 파이프라인 (로컬 실행. 배포 대상 아님)
├── data/seed/             시드 입력 (13_*.json) · 중간 산출물
├── docs/                  설계 문서 · 시연 목업 · 배포 안내
└── stats-compass-web/     Next.js 앱 ← Vercel 이 배포하는 건 여기뿐
    ├── src/app/research/  생애나침반 검색 화면
    ├── src/lib/kosis.ts   KOSIS 공유서비스 호출
    └── supabase/          SQL 마이그레이션
```

---

## 실행

### 웹앱

```bash
cd stats-compass-web
npm install
cp .env.example .env.local     # 값을 채워 넣으세요
npm run dev
```

필요한 환경변수는 `.env.example` 에 설명과 함께 적어 뒀습니다.
`OPENAI_API_KEY` 와 `KOSIS_API_KEY` 에 **`NEXT_PUBLIC_` 을 붙이지 마세요.**
붙이면 브라우저 번들에 실려 키가 공개됩니다.

### DB

`stats-compass-web/supabase/` 의 SQL 을 번호순으로 실행합니다.
`0009`~`0016` 은 같은 함수를 계속 다시 정의하는 것이라 **마지막 `0016_recency_fix.sql`
하나만 돌려도 됩니다.**

### 시드 파이프라인

```bash
npx tsx src/seed/01_fetchTables.ts      # KOSIS 통계표 목록
npx tsx src/seed/05_fetchPeriods.ts     # 수록 주기·시작·최신 시점
npx tsx src/seed/12_buildOntology.ts    # 온톨로지 구축
npx tsx src/seed/14_fetchNews.ts        # 보도자료 크롤링
npx tsx src/seed/15_embed.ts            # 임베딩 (main/alias/meta)
npx tsx src/seed/16_checkScenarios.ts   # 검증
```

`05` 는 전체 11,163개 통계표를 다루면 분당 200건 제한 때문에 66분 걸립니다.
`--targets` 를 붙이면 생애주기 대상 27개 조사(6,433건)만 처리합니다.

---

## 알아 둘 것 · 한계

**시계열 단절을 판정하지 않습니다.** 조사에는 표본·모집단·분류체계 개편이 있습니다.
가계금융복지조사만 해도 2012·2015·2018·2019·2023년에 개편이 있었습니다. 화면의 막대는
KOSIS 원본 값을 그대로 늘어놓은 것일 뿐입니다. 증감을 인용하려면 조사연혁을 확인해야
합니다.

**대표 계열은 추정입니다.** 통계표 하나가 한 시점에 수백 행입니다(`DT_1HDLD04` 는 602행).
서버가 "계·전체" 성격의 계열 하나를 골라 보여 주는데, 그 표에 "계"가 없으면 값이 큰
쪽을 고릅니다. 무엇을 골랐는지는 카드에 그대로 적습니다. 감추면 오해를 부릅니다.

**혼동쌍은 탈락 사유가 아닙니다.** 그래프에서 밀린 조사에 혼동쌍 상대를 함께 표시하지만,
탈락은 점수 때문이지 혼동쌍 때문이 아닙니다.

**KOSIS 호출 제한.** 분당 200건입니다. 통계표 12개를 부르면 표당 최대 2회(메타+자료)라
24건입니다. 메타는 서버 메모리에 1시간 캐시하지만 서버리스 인스턴스가 갈리면 캐시도
갈립니다.

---

## 기술

Next.js 15 (App Router) · React 19 · Tailwind v4 · Supabase(PostgreSQL) ·
pgvector · pg_trgm · OpenAI `text-embedding-3-small` · KOSIS 공유서비스 OpenAPI

배포 절차는 [`docs/배포.md`](docs/배포.md) 를 보세요.
