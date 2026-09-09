/**
 * statistic_tables.latest_period 채우기
 *
 * 기존 02_fetchMeta.ts 는 통계설명자료(statisticsList.do, type=TBL)를 부르기 때문에
 * 수록 시점 정보가 오지 않습니다. 수록정보는 다른 엔드포인트입니다.
 *
 *   GET https://kosis.kr/openapi/statisticsData.do
 *       ?method=getMeta&apiKey=...&orgId=101&tblId=DT_1HP005&type=PRD&format=json&jsonVD=Y
 *
 * 실제 응답 (2026-09-09 확인):
 *   [{ "PRD_SE": "년", "STRT_PRD_DE": "2016", "END_PRD_DE": "2024" }]
 *   → PRD_SE 는 코드(Y/M)가 아니라 한글 표기입니다.
 *
 * ⚠️ KOSIS OpenAPI 는 1분당 200건 제한(err 40)이 있습니다.
 *    아래 rateGate() 가 60초 슬라이딩 윈도로 호출량을 스스로 조절하고,
 *    그래도 40 이 나면 윈도가 열릴 때까지 기다렸다 재시도합니다.
 *
 * 실행:
 *   npx tsx src/seed/05_fetchPeriods.ts            # latest_period 가 비어 있는 것만
 *   npx tsx src/seed/05_fetchPeriods.ts --all      # 전체 다시 조회
 *   npx tsx src/seed/05_fetchPeriods.ts --dry-run  # DB 업데이트 없이 확인만
 *   npx tsx src/seed/05_fetchPeriods.ts --limit=50 # 앞의 50건만 (연결 시험용)
 */
import 'dotenv/config';
import { supabase } from '../clients/supabase.js';
import { readFileSync } from 'node:fs';
import { log } from '../utils/logger.js';

const BASE = 'https://kosis.kr/openapi/statisticsData.do';
const API_KEY = process.env.KOSIS_API_KEY;
if (!API_KEY) throw new Error('KOSIS_API_KEY is required in .env');

const ALL = process.argv.includes('--all');
const DRY = process.argv.includes('--dry-run');
/**
 * 생애나침반 대상 27개 조사의 통계표만.
 *
 * 전체 11,163건은 분당 170건 제한 때문에 66분이 걸립니다. 그런데 /research 가
 * 실제로 다루는 건 13_stages.json 에 적힌 조사들의 표뿐입니다.
 * 나머지는 급하지 않으니 나중에 옵션 없이 한 번 더 돌리면 됩니다.
 */
const TARGETS = process.argv.includes('--targets');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : Infinity;

/** KOSIS 분당 허용치는 200. 안전 여유를 두고 기본 170. */
const RATE_PER_MIN = Number(process.env.KOSIS_RATE_LIMIT ?? '170');
const CONCURRENCY = Number(process.env.SEED_CONCURRENCY ?? '4');
const WINDOW_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 분당 호출량 게이트 (60초 슬라이딩 윈도)                                 */
/* ------------------------------------------------------------------ */

const callTimes: number[] = [];

async function rateGate(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (callTimes.length > 0 && now - callTimes[0] > WINDOW_MS) callTimes.shift();
    if (callTimes.length < RATE_PER_MIN) {
      // 검사와 기록 사이에 await 가 없으므로 동시 실행 중에도 초과하지 않습니다.
      callTimes.push(now);
      return;
    }
    await sleep(WINDOW_MS - (now - callTimes[0]) + 150);
  }
}

/* ------------------------------------------------------------------ */
/* 응답 파싱                                                             */
/* ------------------------------------------------------------------ */

const END_KEYS = ['END_PRD_DE', 'PRD_DE_END', 'PRD_DE_TO', 'END_DE', 'endPrdDe'];
const START_KEYS = ['STRT_PRD_DE', 'PRD_DE_STRT', 'PRD_DE_FROM', 'STRT_DE', 'startPrdDe'];
const CYCLE_KEYS = ['PRD_SE', 'prdSe', 'CYCLE'];

/**
 * 한글 주기 → KOSIS getList 의 prdSe 코드.
 *
 * 응답은 한글("년")로 오는데 자료 조회 파라미터는 코드("Y")를 받습니다.
 * 이 변환을 여기서 해 두지 않으면 화면에서 통계표마다 주기를 다시 알아내야 합니다.
 */
const PRD_CODE: Record<string, string> = {
  년: 'Y', 연: 'Y', 연간: 'Y', Y: 'Y',
  반기: 'H', H: 'H', S: 'H',
  분기: 'Q', Q: 'Q',
  월: 'M', 월간: 'M', M: 'M',
  일: 'D', D: 'D',
  '2년': 'F', '3년': 'F', '5년': 'F', 다년: 'F', F: 'F',
  부정기: 'IR', IR: 'IR',
};

function toPrdCode(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  return PRD_CODE[s] ?? PRD_CODE[s.toUpperCase()] ?? null;
}

/** 한 통계표의 수록정보 — 주기·시작·최신 셋을 다 씁니다 */
interface PeriodInfo {
  prd_se: string | null;
  first_period: string | null;
  latest_period: string;
}

/**
 * 주기 우선순위. 한 통계표가 월·연을 동시에 수록하면 더 잦은 주기의
 * 종료시점이 최신이므로 그쪽을 채택합니다.
 * PRD_SE 는 한글로 오지만(년/월/분기) 코드로 오는 경우도 대비합니다.
 */
const CYCLE_RANK: Record<string, number> = {
  일: 7, D: 7,
  월: 6, M: 6,
  분기: 5, Q: 5,
  반기: 4, S: 4,
  년: 3, 연: 3, Y: 3,
  '2년': 2, '3년': 2, '5년': 2, 다년: 2, F: 2,
  부정기: 1, IR: 1,
};

function pickKey(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

let loggedShape = false;
let rateHits = 0;

/** err 40(호출 초과)이면 윈도가 열릴 때까지 기다렸다 다시 시도 */
async function fetchPeriod(orgId: string, tblId: string): Promise<PeriodInfo | null> {
  const url = new URL(BASE);
  url.searchParams.set('method', 'getMeta');
  url.searchParams.set('apiKey', API_KEY!);
  url.searchParams.set('orgId', orgId);
  url.searchParams.set('tblId', tblId);
  url.searchParams.set('type', 'PRD');
  url.searchParams.set('format', 'json');
  url.searchParams.set('jsonVD', 'Y');

  for (let attempt = 0; attempt < 6; attempt++) {
    await rateGate();
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && typeof data === 'object' && !Array.isArray(data) && 'err' in data) {
        const code = String((data as any).err);
        if (code === '40') {
          // 분당 한도 초과 — 윈도가 완전히 비워질 때까지 대기 후 재시도
          rateHits++;
          const oldest = callTimes[0] ?? Date.now();
          await sleep(Math.max(3_000, WINDOW_MS - (Date.now() - oldest) + 500));
          continue;
        }
        log.warn(`[${tblId}] KOSIS err ${code}: ${(data as any).errMsg}`);
        return null;
      }

      const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [data];
      if (rows.length === 0) return null;

      if (!loggedShape) {
        loggedShape = true;
        log.info(`첫 응답: ${JSON.stringify(rows[0])}`);
      }

      // 한 통계표가 월·연을 동시에 수록하면 더 잦은 주기 쪽을 채택합니다.
      // 그 행의 주기·시작·종료를 <한 벌로> 가져와야 합니다. 따로 고르면 짝이 안 맞습니다.
      let best: { info: PeriodInfo; rank: number } | null = null;
      for (const r of rows) {
        const end = pickKey(r, END_KEYS);
        if (!end) continue;
        const cycle = pickKey(r, CYCLE_KEYS) ?? '';
        const rank = CYCLE_RANK[cycle] ?? CYCLE_RANK[cycle.toUpperCase()] ?? 0;
        if (!best || rank > best.rank || (rank === best.rank && end > best.info.latest_period)) {
          best = {
            rank,
            info: {
              prd_se: toPrdCode(cycle),
              first_period: pickKey(r, START_KEYS),
              latest_period: end,
            },
          };
        }
      }
      return best?.info ?? null;
    } catch (e: any) {
      if (attempt >= 3) {
        log.err(`[${tblId}] 조회 실패`, e.message);
        return null;
      }
      await sleep(800 * Math.pow(2, attempt));
    }
  }
  log.warn(`[${tblId}] 재시도 초과`);
  return null;
}

/* ------------------------------------------------------------------ */
/* DB                                                                    */
/* ------------------------------------------------------------------ */

interface TableRow {
  id: string;
  kosis_org_id: string | null;
  kosis_tbl_id: string | null;
}

/** 13_stages.json 에 적힌 대상 조사들의 statistics.id */
async function targetStatIds(): Promise<string[]> {
  const path = new URL('../../data/seed/13_stages.json', import.meta.url);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    surveyStages?: Record<string, string[]>;
  };
  const names = Object.keys(raw.surveyStages ?? {});
  if (names.length === 0) throw new Error('13_stages.json 에 surveyStages 가 없습니다');

  const { data, error } = await supabase
    .from('statistics')
    .select('id, name_ko')
    .in('name_ko', names);
  if (error) throw error;

  const ids = (data ?? []).map((r) => String((r as { id: string }).id));
  const found = new Set((data ?? []).map((r) => String((r as { name_ko: string }).name_ko)));
  const miss = names.filter((n) => !found.has(n));
  if (miss.length > 0) log.warn(`조사명 매칭 실패 ${miss.length}건: ${miss.slice(0, 5).join(', ')}`);
  log.info(`대상 조사 ${ids.length}건`);
  return ids;
}

/** PostgREST 기본 1000행 제한을 피해 페이지 단위로 모두 읽습니다 */
async function loadTables(): Promise<TableRow[]> {
  const out: TableRow[] = [];
  const PAGE = 1000;
  const statIds = TARGETS ? await targetStatIds() : null;

  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('statistic_tables')
      .select('id, kosis_org_id, kosis_tbl_id')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (statIds) q = q.in('statistic_id', statIds);
    // prd_se 는 나중에 추가한 칸이라, 최신시점만 있고 주기가 빈 행도 다시 채웁니다.
    if (!ALL) q = q.or('latest_period.is.null,prd_se.is.null');

    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as TableRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}

async function flush(rows: Array<{ id: string } & PeriodInfo>): Promise<void> {
  if (DRY || rows.length === 0) return;
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    await Promise.all(
      rows.slice(i, i + BATCH).map((u) =>
        supabase
          .from('statistic_tables')
          .update({
            latest_period: u.latest_period,
            first_period: u.first_period,
            prd_se: u.prd_se,
          })
          .eq('id', u.id),
      ),
    );
  }
}

/* ------------------------------------------------------------------ */

async function main() {
  const all = await loadTables();
  const tables = Number.isFinite(LIMIT) ? all.slice(0, LIMIT) : all;
  const mode = [
    ALL ? 'all' : 'empty-only',
    TARGETS ? '대상 조사만' : '전체 조사',
    DRY ? 'dry-run' : 'write',
  ].join(', ');
  log.info(`대상 통계표 ${tables.length}건 (${mode})`);
  log.info(`호출 제한 ${RATE_PER_MIN}건/분 · 동시 ${CONCURRENCY} → 예상 ${Math.ceil(tables.length / RATE_PER_MIN)}분`);
  if (tables.length === 0) return;

  const t0 = Date.now();
  let done = 0;
  let ok = 0;
  let missing = 0;
  let pending: Array<{ id: string } & PeriodInfo> = [];
  const samples: string[] = [];

  // 워커 방식: 동시 실행 수를 고정하고 큐에서 하나씩 꺼내 처리
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= tables.length) return;
      const t = tables[i];
      if (t.kosis_org_id && t.kosis_tbl_id) {
        const period = await fetchPeriod(t.kosis_org_id, t.kosis_tbl_id);
        if (period) {
          ok++;
          pending.push({ id: t.id, ...period });
          if (samples.length < 8) {
            samples.push(
              `${period.prd_se ?? '?'} ${period.first_period ?? '?'}~${period.latest_period}`,
            );
          }
        } else {
          missing++;
        }
      }
      done++;

      // 중간 저장 — 도중에 끊겨도 여기까지는 남습니다
      if (pending.length >= 200) {
        const batch = pending;
        pending = [];
        await flush(batch);
        log.info(`중간 저장 ${batch.length}건`);
      }
      if (done % 100 === 0) {
        const rate = done / ((Date.now() - t0) / 1000);
        const eta = Math.ceil((tables.length - done) / rate / 60);
        log.info(`진행 ${done}/${tables.length} (확보 ${ok}, 미확보 ${missing}, 한도대기 ${rateHits}회, 남은시간 ~${eta}분)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await flush(pending);

  const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  log.ok(`완료 ${elapsed}분 — 확보 ${ok}건 / 미확보 ${missing}건 / 한도대기 ${rateHits}회`);
  log.info(`값 샘플: ${JSON.stringify(samples)}`);

  if (DRY) {
    log.warn('--dry-run 이므로 DB 를 수정하지 않았습니다.');
    return;
  }
  const { count } = await supabase
    .from('statistic_tables')
    .select('id', { count: 'exact', head: true })
    .not('latest_period', 'is', null);
  log.ok(`DB 확인 — latest_period 보유 통계표 ${count}건`);
}

main().catch((e) => {
  log.err('Fatal', e);
  process.exit(1);
});
