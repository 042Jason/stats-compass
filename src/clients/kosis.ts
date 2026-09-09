import 'dotenv/config';
import type { KosisListItem, KosisTableMeta } from '../types.js';

const BASE = 'https://kosis.kr/openapi';
const API_KEY = process.env.KOSIS_API_KEY;

if (!API_KEY) throw new Error('KOSIS_API_KEY is required in .env');

/* ------------------------------------------------------------------ */
/* 분당 호출량 제한                                                       */
/*                                                                      */
/* KOSIS OpenAPI 는 1분에 200건까지만 허용하고, 넘으면 err 40 을 돌려줍니다. */
/* 이전 크롤링에서 이걸 지키지 않아 10개 하위 트리가 통째로 유실됐습니다.      */
/* 모든 KOSIS 호출이 이 게이트를 통과하도록 클라이언트 레벨에 둡니다.         */
/* ------------------------------------------------------------------ */

const RATE_PER_MIN = Number(process.env.KOSIS_RATE_LIMIT ?? '170');
const WINDOW_MS = 60_000;
const callTimes: number[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** 진행 로그용 — 지금까지 한 호출 수 */
export let totalCalls = 0;

async function kosisFetch<T>(endpoint: string, params: Record<string, string>, retries = 4): Promise<T> {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('apiKey', API_KEY!);
  url.searchParams.set('format', 'json');
  url.searchParams.set('jsonVD', 'Y');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt <= retries; attempt++) {
    await rateGate();
    totalCalls++;
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && typeof data === 'object' && 'err' in data) {
        const code = String((data as any).err);

        // 40 = 분당 호출 초과. 예전에는 이걸 실패로 처리해 하위 트리를 버렸습니다.
        // 윈도가 열릴 때까지 기다렸다 반드시 재시도합니다.
        if (code === '40') {
          const oldest = callTimes[0] ?? Date.now();
          await sleep(Math.max(3_000, WINDOW_MS - (Date.now() - oldest) + 500));
          continue;
        }
        // 30/-30 = 자료 없음 계열 → 재시도 무의미
        if (['10', '30', '-30'].includes(code)) {
          throw new Error(`KOSIS error [${code}]: ${(data as any).errMsg}`);
        }
        throw new Error(`KOSIS transient [${code}]: ${(data as any).errMsg}`);
      }
      return data as T;
    } catch (e: any) {
      if (attempt === retries) throw e;
      await sleep(700 * Math.pow(2, attempt));
    }
  }
  throw new Error('unreachable');
}

export function fetchListByOrg(parentListId?: string) {
  const p: Record<string, string> = { method: 'getList', vwCd: 'MT_OTITLE' };
  if (parentListId) p.parentListId = parentListId;
  return kosisFetch<KosisListItem[]>('statisticsList.do', p);
}

export function fetchListByTopic(parentListId?: string) {
  const p: Record<string, string> = { method: 'getList', vwCd: 'MT_ZTITLE' };
  if (parentListId) p.parentListId = parentListId;
  return kosisFetch<KosisListItem[]>('statisticsList.do', p);
}

export function fetchTableMeta(orgId: string, tblId: string) {
  return kosisFetch<KosisTableMeta[]>('statisticsList.do', {
    method: 'getMeta', orgId, tblId, type: 'TBL'
  });
}

/** 통계표 수록정보(주기·시작·종료 시점) */
export function fetchTablePeriod(orgId: string, tblId: string) {
  return kosisFetch<Record<string, unknown>[]>('statisticsData.do', {
    method: 'getMeta', orgId, tblId, type: 'PRD'
  });
}
