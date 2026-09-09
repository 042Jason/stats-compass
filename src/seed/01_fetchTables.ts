/**
 * 국가데이터처(orgId=101) 통계표 수집 — 기관별 트리 기준, 중단·재개 가능
 *
 * ★ 왜 기관별(MT_OTITLE) 트리인가
 *   예전 크롤러는 주제별(MT_ZTITLE) 트리 전체를 훑으면서 ORG_ID==='101' 인 것만
 *   골라 담았습니다. 다른 부처 통계까지 다 순회하니 호출이 6,000회를 넘었고,
 *   그러다 호출 제한에 걸리고 중단돼 1,378건만 남았습니다.
 *
 *   기관별 트리에서 parentListId=101 로 들어가면 우리 기관 하위만 탑니다.
 *   게다가 그 1단계 노드가 곧 '조사' 입니다(69개).
 *     101 > 경제활동인구조사 > ... > (통계표)
 *     101 > 인구총조사 > ... > (통계표)
 *   그래서 조사명을 statsNm 으로 역산할 필요 없이 트리에서 바로 얻습니다.
 *
 * ★ 주의: 이 트리의 category_path 는 '조사 > 하위분류' 이지 주제 분류가 아닙니다.
 *   화면에 쓰는 주제 카테고리(인구·노동·물가…)는 02 단계에서 받는
 *   통계설명자료의 statsField 를 씁니다.
 *
 * 실행:
 *   npx tsx src/seed/01_fetchTables.ts           # 중단 지점부터 이어서
 *   npx tsx src/seed/01_fetchTables.ts --fresh   # 처음부터
 *   npx tsx src/seed/01_fetchTables.ts --topic   # 예전 방식(주제별 전체 순회)
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { fetchListByOrg, fetchListByTopic } from '../clients/kosis.js';
import type { CollectedTable, KosisListItem } from '../types.js';
import { log } from '../utils/logger.js';

const OUT_DIR = 'data/seed';
const OUT_FILE = `${OUT_DIR}/01_tables.json`;
const STATE_FILE = `${OUT_DIR}/01_state.json`;
const ORG_ID = process.env.KOSIS_ORG_ID ?? '101';
const FRESH = process.argv.includes('--fresh');
const TOPIC_MODE = process.argv.includes('--topic');

interface QueueNode { listId?: string; crumbs: string[] }
interface State {
  queue: QueueNode[];
  visited: string[];
  tables: CollectedTable[];
  calls: number;
  failed: number;
  mode: string;
}

const MODE = TOPIC_MODE ? 'topic' : 'org';

function initialState(): State {
  return {
    // 기관별 모드는 우리 기관 노드에서 시작합니다.
    queue: [TOPIC_MODE ? { crumbs: [] } : { listId: ORG_ID, crumbs: [] }],
    visited: [],
    tables: [],
    calls: 0,
    failed: 0,
    mode: MODE,
  };
}

function loadState(): State {
  if (!FRESH && existsSync(STATE_FILE)) {
    try {
      const s = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as State;
      if (s.mode !== MODE) {
        log.warn(`이전 상태는 '${s.mode}' 모드입니다. 모드가 달라 처음부터 시작합니다.`);
        return initialState();
      }
      log.ok(`이어서 진행 — 수집 ${s.tables.length}건, 남은 큐 ${s.queue.length}개`);
      return s;
    } catch {
      log.warn('상태 파일을 읽지 못해 처음부터 시작합니다.');
    }
  }
  return initialState();
}

function saveJson(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, path);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const state = loadState();
  const visited = new Set(state.visited);
  const byKey = new Map(state.tables.map((t) => [`${t.org_id}:${t.tbl_id}`, t]));

  log.info(`모드: ${MODE === 'org' ? `기관별(MT_OTITLE) — ${ORG_ID} 하위만` : '주제별(MT_ZTITLE) 전체'}`);

  let stopping = false;
  const onSignal = () => {
    if (stopping) process.exit(1);
    stopping = true;
    log.warn('중단 신호 — 상태를 저장하고 종료합니다. 다시 실행하면 이어서 진행합니다.');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const flush = () => {
    state.visited = [...visited];
    state.tables = [...byKey.values()];
    saveJson(STATE_FILE, state);
    saveJson(OUT_FILE, state.tables);
  };

  const t0 = Date.now();
  let sinceFlush = 0;

  while (state.queue.length > 0 && !stopping) {
    const node = state.queue.shift()!;
    if (node.listId) {
      if (visited.has(node.listId)) continue;
      visited.add(node.listId);
    }

    let items: KosisListItem[] = [];
    try {
      items = MODE === 'org' ? await fetchListByOrg(node.listId) : await fetchListByTopic(node.listId);
      state.calls++;
    } catch (e: any) {
      state.failed++;
      log.err(`조회 실패 [${node.crumbs.join(' > ') || '(root)'}]`, e.message);
      if (node.listId) visited.delete(node.listId);
      continue;
    }
    if (!Array.isArray(items)) continue;

    for (const it of items) {
      if (it.TBL_ID) {
        // 기관별 모드에서는 이 서브트리 전체가 우리 기관 것이므로 ORG_ID 로 거르지 않습니다.
        // (예: 농가판매및구입가격조사 노드는 목록ID 가 306_ 로 시작하지만 우리 조사입니다)
        if (MODE === 'topic' && it.ORG_ID !== ORG_ID) continue;
        const key = `${it.ORG_ID}:${it.TBL_ID}`;
        if (byKey.has(key)) continue;
        byKey.set(key, {
          org_id: it.ORG_ID!,
          tbl_id: it.TBL_ID!,
          tbl_nm: it.TBL_NM ?? '',
          stat_nm: it.STAT_NM ?? '',
          survey_name: node.crumbs[0] ?? '',
          kosis_stat_id: it.STAT_ID,
          category_path: node.crumbs.join(' > '),
          full_path_id: it.FULL_PATH_ID,
          link_url: it.LINK_URL,
        });
      } else if (it.LIST_ID && !visited.has(it.LIST_ID)) {
        state.queue.push({ listId: it.LIST_ID, crumbs: [...node.crumbs, it.LIST_NM?.trim() ?? '?'] });
      }
    }

    if (++sinceFlush >= 25) {
      sinceFlush = 0;
      flush();
      const mins = (Date.now() - t0) / 60000;
      const eta = Math.ceil(state.queue.length / Math.max(state.calls / Math.max(mins, 0.01), 1));
      log.info(`호출 ${state.calls} · 표 ${byKey.size} · 남은 큐 ${state.queue.length} · 실패 ${state.failed} · ~${eta}분`);
    }
  }

  flush();
  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);

  if (state.queue.length > 0) {
    log.warn(`중단됨 — 표 ${byKey.size}건 저장, 남은 큐 ${state.queue.length}개. 다시 실행하면 이어서 합니다.`);
    return;
  }

  log.ok(`완료 ${elapsed}분 · 호출 ${state.calls}회 — 통계표 ${byKey.size}건 -> ${OUT_FILE}`);
  if (state.failed > 0) log.warn(`조회 실패 ${state.failed}건`);

  const bySurvey = new Map<string, number>();
  for (const t of byKey.values()) {
    const k = t.survey_name || '(미분류)';
    bySurvey.set(k, (bySurvey.get(k) ?? 0) + 1);
  }
  log.info(`조사 ${bySurvey.size}개:`);
  [...bySurvey.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
    console.log(`   ${String(n).padStart(5)}  ${k}`),
  );
}

main().catch((e) => { log.err('Fatal', e); process.exit(1); });
