/**
 * 통계설명자료(메타) 조회 — 조사 단위, 중단·재개 가능
 *
 * ★ 왜 조사 단위인가
 *   getMeta 는 통계표ID 로 부르지만 내용은 사실상 '조사' 단위입니다.
 *   같은 조사에 속한 통계표 수백 개가 모두 동일한 조사목적·법적근거·조사연혁을
 *   돌려줍니다. 표마다 부르면 8,000회가 넘어 50분이 걸리지만,
 *   조사마다 대표 표 하나만 부르면 69회로 끝납니다.
 *   받은 메타는 그 조사의 모든 표에 복사해 둡니다.
 *
 *   표마다 정확히 받아야 하면 --per-table 을 쓰세요(오래 걸립니다).
 *
 * 호출 제한은 clients/kosis.ts 의 게이트가 처리합니다(분당 170건, err 40 자동 대기).
 *
 *   npx tsx src/seed/02_fetchMeta.ts              # 조사 단위 (권장)
 *   npx tsx src/seed/02_fetchMeta.ts --per-table  # 통계표 단위 (전수)
 *   npx tsx src/seed/02_fetchMeta.ts --fresh      # 처음부터
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { fetchTableMeta } from '../clients/kosis.js';
import type { CollectedTable, EnrichedTable } from '../types.js';
import { log } from '../utils/logger.js';

const IN_FILE = 'data/seed/01_tables.json';
const OUT_FILE = 'data/seed/02_meta.json';
const FRESH = process.argv.includes('--fresh');
const PER_TABLE = process.argv.includes('--per-table');
const CONCURRENCY = Number(process.env.SEED_CONCURRENCY ?? '4');

/** 조사명 — 기관별 트리에서 온 survey_name 이 없으면 분류경로 첫 마디 */
const surveyName = (t: CollectedTable) =>
  (t.survey_name && t.survey_name.trim()) || String(t.category_path ?? '').split(' > ')[0] || t.tbl_id;

const key = (t: { org_id: string; tbl_id: string }) => `${t.org_id}:${t.tbl_id}`;

function saveJson(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, path);
}

async function main() {
  const tables: CollectedTable[] = JSON.parse(readFileSync(IN_FILE, 'utf-8'));

  const done = new Map<string, EnrichedTable>();
  if (!FRESH && existsSync(OUT_FILE)) {
    try {
      const prev: EnrichedTable[] = JSON.parse(readFileSync(OUT_FILE, 'utf-8'));
      for (const t of prev) if (t.meta) done.set(key(t), t);
      log.ok(`이어서 진행 — 이미 받은 메타 ${done.size}건`);
    } catch {
      log.warn('기존 메타 파일을 읽지 못해 처음부터 받습니다.');
    }
  }

  // ★ 조사명은 반드시 지금 로드한 01_tables.json 기준으로 정합니다.
  //   예전 02_meta.json 항목에는 survey_name 이 없어서, 그걸로 조사명을 뽑으면
  //   조사 단위 복사가 전혀 매칭되지 않습니다(1369/11153 만 채워지던 원인).
  const surveyByKey = new Map<string, string>();
  for (const t of tables) surveyByKey.set(key(t), surveyName(t));

  // 조사별 후보 표 목록 (대표가 실패하면 다음 표로 재시도)
  const candidates = new Map<string, CollectedTable[]>();
  for (const t of tables) {
    const s = surveyByKey.get(key(t))!;
    if (!candidates.has(s)) candidates.set(s, []);
    candidates.get(s)!.push(t);
  }
  for (const list of candidates.values()) {
    list.sort((a, b) => String(a.category_path ?? '').length - String(b.category_path ?? '').length);
  }

  // 이미 메타를 가진 조사는 건너뜁니다.
  const haveSurvey = new Set<string>();
  for (const [k, t] of done) if (t.meta && surveyByKey.has(k)) haveSurvey.add(surveyByKey.get(k)!);

  let todo: CollectedTable[];
  if (PER_TABLE) {
    todo = tables.filter((t) => !done.has(key(t)));
    log.info(`통계표 단위 — ${tables.length}건 중 ${todo.length}건 조회 (동시 ${CONCURRENCY})`);
  } else {
    todo = [...candidates.entries()]
      .filter(([s]) => !haveSurvey.has(s))
      .map(([, list]) => list[0]);
    log.info(
      `조사 단위 — 조사 ${candidates.size}개 중 ${todo.length}개 조회 (통계표 ${tables.length}건, 기보유 ${haveSurvey.size}개)`,
    );
  }
  if (todo.length === 0) {
    log.ok('받을 것이 없습니다.');
    return;
  }

  let stopping = false;
  process.on('SIGINT', () => { stopping = true; log.warn('중단 신호 — 저장 후 종료합니다.'); });

  const flush = () => {
    // 조사 단위로 받은 메타를 같은 조사의 모든 표에 복사합니다.
    const bySurvey = new Map<string, EnrichedTable['meta']>();
    if (!PER_TABLE) {
      for (const [k, t] of done) {
        const s = surveyByKey.get(k);
        if (t.meta && s && !bySurvey.has(s)) bySurvey.set(s, t.meta);
      }
    }
    const merged = tables.map((t) => {
      const k = key(t);
      const exact = done.get(k);
      if (exact?.meta) return { ...t, meta: exact.meta } as EnrichedTable;
      const shared = PER_TABLE ? undefined : bySurvey.get(surveyByKey.get(k)!);
      return shared ? ({ ...t, meta: shared } as EnrichedTable) : ({ ...t } as EnrichedTable);
    });
    saveJson(OUT_FILE, merged);
  };

  const t0 = Date.now();
  let processed = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (!stopping) {
      const i = cursor++;
      if (i >= todo.length) return;
      const t = todo[i];
      // 대표 표가 메타를 안 주는 경우가 있어 같은 조사의 다음 표로 최대 4번까지 시도합니다.
      const tries = PER_TABLE ? [t] : (candidates.get(surveyByKey.get(key(t))!) ?? [t]).slice(0, 4);
      let got = false;
      for (const c of tries) {
        try {
          const arr = await fetchTableMeta(c.org_id, c.tbl_id);
          const meta = Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
          if (meta) {
            done.set(key(c), { ...c, meta } as EnrichedTable);
            got = true;
            break;
          }
        } catch {
          /* 다음 후보로 */
        }
      }
      if (!got) {
        failed++;
        if (failed <= 10) log.warn(`메타 없음: ${surveyByKey.get(key(t))}`);
      }
      processed++;
      if (processed % 100 === 0) {
        flush();
        const mins = (Date.now() - t0) / 60000;
        const eta = Math.ceil((todo.length - processed) / Math.max(processed / Math.max(mins, 0.01), 1));
        log.info(`진행 ${processed}/${todo.length} (실패 ${failed}, 남은시간 ~${eta}분)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  flush();

  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
  if (stopping) {
    log.warn(`중단됨 — 메타 ${done.size}건 저장. 다시 실행하면 이어서 진행합니다.`);
    return;
  }
  const covered = JSON.parse(readFileSync(OUT_FILE, 'utf-8')).filter((t: EnrichedTable) => t.meta).length;
  log.ok(`완료 ${elapsed}분 — 호출 ${done.size}건으로 통계표 ${covered}/${tables.length}건 메타 확보 -> ${OUT_FILE}`);
  if (failed > 0) log.warn(`${failed}건 실패 (다시 실행하면 재시도합니다)`);
}

main().catch((e) => { log.err('Fatal', e); process.exit(1); });
