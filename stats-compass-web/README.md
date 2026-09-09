# 통계나침반 (Stats Compass) — 프론트엔드

국가데이터처(구 통계청) 승인통계를 큐레이션하는 공공서비스형 웹사이트의 Next.js 프론트엔드입니다.
KOSIS OpenAPI에서 수집해 Supabase에 적재한 통계 메타데이터를 읽기 전용(anon key)으로 조회합니다.

- Next.js 15 (App Router, TypeScript, Server Components 우선)
- Tailwind CSS v4 + shadcn/ui 스타일 컴포넌트 (`src/components/ui`)
- Supabase JS SDK (서버 컴포넌트에서만 사용, `server-only`)
- Pretendard 폰트 (jsDelivr CDN), lucide-react 아이콘

## 1. 로컬 실행

```bash
# Node.js 20 이상
cd stats-compass-web
npm install
cp .env.example .env.local     # 값은 이미 채워져 있음 (anon key)
npm run dev                    # http://localhost:3000
```

기타 스크립트

```bash
npm run build        # 프로덕션 빌드
npm run start        # 빌드 결과 실행
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
```

## 2. 환경변수

| 변수 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable(anon) key — RLS로 읽기만 허용 |
| `NEXT_PUBLIC_SITE_URL` | 배포 URL (sitemap / OG 용, 선택) |

Secret key는 프론트엔드에서 사용하지 않습니다.

## 3. 검색 함수 적용 (한 번만)

Supabase 대시보드 → **SQL Editor** 에서 `supabase/migrations/0001_search_all_rpc.sql` 내용을 실행하세요.
`search_all(q, lim)` 함수가 만들어지며, Postgres FTS(`search_vector`) + pg_trgm + ILIKE 를 조합해
조사 마스터와 통계표를 한 번에 검색합니다.

함수를 아직 적용하지 않아도 검색 페이지는 동작합니다(클라이언트 측 `textSearch` + `ilike` 조합으로 자동 대체되며,
결과 하단에 안내 문구가 표시됩니다).

## 4. Vercel 배포

1. GitHub 리포 `042Jason/stats-compass` 에 이 폴더의 내용을 push 합니다.
   ```bash
   git init
   git add .
   git commit -m "feat: 통계나침반 프론트엔드 초기 구축"
   git branch -M main
   git remote add origin https://github.com/042Jason/stats-compass.git
   git push -u origin main        # 기존 setup.mjs 만 있는 리포라면 --force 필요할 수 있음
   ```
   리포 루트가 아닌 하위 폴더에 두려면 Vercel 프로젝트 설정의 **Root Directory** 를 맞춰 주세요.
2. https://vercel.com/new 에서 리포를 Import → Framework: **Next.js** 자동 인식.
3. **Environment Variables** 에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, (선택) `NEXT_PUBLIC_SITE_URL` 을 등록.
4. Deploy. 이후 main 브랜치 push 마다 자동 배포됩니다.

## 5. 폴더 구조

```
stats-compass-web/
├─ src/
│  ├─ app/                      # App Router 페이지
│  │  ├─ page.tsx               # 홈: 카테고리, 세트, 최근 조사, What's New
│  │  ├─ browse/                # 전체 조사 (분야 필터·정렬·페이지네이션)
│  │  ├─ statistics/[stat_id]/  # 조사 상세 (개요·통계표·연혁·소식·관련 조사)
│  │  ├─ sets/, sets/[slug]/    # 큐레이션 세트 목록·상세
│  │  ├─ whats-new/             # 이벤트 타임라인 (연도별 그룹)
│  │  ├─ deep-dives/, [slug]/   # Deep Dive 목록·상세 (마크다운 본문)
│  │  ├─ search/                # 통합 검색 (RPC → fallback)
│  │  ├─ sitemap.ts, robots.ts
│  │  ├─ layout.tsx, globals.css, error.tsx, not-found.tsx, loading.tsx
│  ├─ components/
│  │  ├─ ui/                    # button, card, badge, input, tabs, skeleton, separator
│  │  ├─ layout/                # site-header, main-nav(모바일), site-footer
│  │  ├─ shared/                # page-header, section-header, empty-state, error-state, pagination, breadcrumbs
│  │  ├─ statistics/            # StatisticCard, CategoryBadge, KosisLinkButton, TableList, StatisticGrid
│  │  ├─ sets/                  # CuratedSetCard
│  │  ├─ events/                # Timeline
│  │  └─ search/                # SearchBox, HeaderSearch, Highlight
│  └─ lib/
│     ├─ supabase/server.ts     # 서버 전용 클라이언트 + safe() 래퍼
│     ├─ queries/               # statistics, sets, events, articles, search
│     ├─ types.ts               # 테이블 행 타입 / 화면 모델
│     ├─ normalize.ts           # 컬럼명 후보 매핑, tags·날짜 정규화
│     ├─ categories.ts          # 카테고리 → 아이콘/색 메타
│     ├─ format.ts, constants.ts, utils.ts
├─ supabase/migrations/0001_search_all_rpc.sql
├─ .env.example
└─ next.config.ts, tsconfig.json, eslint.config.mjs, postcss.config.mjs
```

## 6. 설계 메모

- **데이터 조회는 모두 서버 컴포넌트**에서 수행하며, 인터랙션이 필요한 곳(모바일 메뉴, 검색창, 탭, 통계표 필터)만 `"use client"` 입니다.
- 모든 조회는 `safe()` 로 감싸 실패 시 예외 대신 `{ error }` 를 돌려주고, 페이지는 `ErrorState` 로 fallback 을 표시합니다.
- 실제 DB 컬럼명이 인계 문서와 다를 수 있어, 연혁·이벤트·세트 등은 `normalize.ts` 의 **후보 키 목록**으로 값을 찾습니다.
  컬럼명이 확정되면 `types.ts`/`normalize.ts` 만 정리하면 됩니다. 정렬이 컬럼에 의존하는 쿼리는 실패 시 정렬 없는 쿼리로 재시도합니다.
- 페이지 캐시: 목록/홈은 ISR 5분(`revalidate = 300`), 검색은 동적(`force-dynamic`).
- `tags` 는 text[] / jsonb / 콤마 문자열 어느 형태여도 `toTags()` 로 표시됩니다.

## 7. TODO / 남은 이슈

- [ ] Supabase 실제 스키마와 컬럼명 대조 (`statistic_history`, `statistic_events`, `curated_set_items.set_id`).
- [ ] `search_all` 함수 적용 후 한국어 검색 품질 점검 (`websearch_to_tsquery('simple')` 은 형태소 분석이 없어 trigram/ILIKE 가 보완).
- [ ] 큐레이션 세트·Deep Dive 콘텐츠 입력 (현재 빈 상태 UI).
- [ ] 필요 시 pgvector 기반 의미 검색 추가.
- [ ] 다크모드 (토큰은 `globals.css` 에 준비되어 있어 `:root[data-theme=dark]` 블록만 추가하면 됨).
