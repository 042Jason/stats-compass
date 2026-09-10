/**
 * 설명자료가 빠진 조사만 다시 받아오기
 *
 *   npx tsx src/seed/22_fillMissingMeta.ts            무엇이 바뀌는지 보기만
 *   npx tsx src/seed/22_fillMissingMeta.ts --apply    실제 반영
 *
 * ── 왜 필요한가
 * 69개 조사 중 19개가 raw_meta 가 비어 있습니다. 작성목적도, 주요용어도,
 * 이용시 유의사항도 없습니다. 그 조사들은 온톨로지에서 반쪽입니다 —
 * definesConcept 도 oftenConfusedWith 도 만들 수 없습니다.
 *
 * ── stat_code 가 없어도 됩니다
 * 처음엔 stat_code(통계승인번호)가 없어서 못 부르는 줄 알았는데, 확인해 보니
 * 02_fetchMeta 는 조사마다 <대표 통계표 하나>의 orgId/tblId 로 getMeta 를 부릅니다.
 * 설명자료 내용이 사실상 조사 단위라 그렇습니다. 그 19개도 통계표는 다 있으니
 * 표 하나만 잡아 다시 부르면 됩니다.
 *
 * ── 왜 처음에 빠졌나
 * 02 는 01_tables.json 의 survey_name 으로 조사를 묶고, 06_regroup 이 그 뒤에
 * 조사를 107→69 로 다시 묶었습니다. 이름이 어긋난 조사는 복사가 안 됐습니다.
 * 이 스크립트는 이름이 아니라 <DB 의 통계표 관계>로 찾으므로 그 문제를 비켜갑니다.
 *
 * 표를 여러 개 시도합니다. 대표 표 하나가 실패해도 다음 표로 넘어갑니다.
 */
import 'dotenv/config';
import { fetchStatExplanation } from '../clients/kosis.js';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

const APPLY = process.argv.includes('--apply');
/** 조사 하나당 최대 몇 개의 표로 시도할지 */
const TRIES = 4;

interface Stat { id: string; stat_id: string; name_ko: string; raw_meta: unknown }
interface Tbl { statistic_id: string; kosis_org_id: string | null; kosis_tbl_id: string | null; table_name: string | null }

/** 설명자료가 실제로 내용이 있는지 — 빈 객체나 껍데기는 실패로 봅니다 */
function hasBody(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const o = meta as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => {
    const v = o[k];
    return v !== null && v !== undefined && String(v).trim() !== '';
  });
  return keys.length >= 3;
}

async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function main() {
  const stats = await pageAll<Stat>((f, t) =>
    supabase
      .from('statistics')
      .select('id, stat_id, name_ko, raw_meta')
      .or('status.is.null,status.neq.merged')
      .order('id')
      .range(f, t),
  );

  const missing = stats.filter((s) => !hasBody(s.raw_meta));
  log.info(`조사 ${stats.length}건 중 설명자료 없음 ${missing.length}건`);
  if (missing.length === 0) return;

  const ids = missing.map((s) => s.id);
  const tables = await pageAll<Tbl>((f, t) =>
    supabase
      .from('statistic_tables')
      .select('statistic_id, kosis_org_id, kosis_tbl_id, table_name')
      .in('statistic_id', ids)
      .order('id')
      .range(f, t),
  );

  const byStat = new Map<string, Tbl[]>();
  for (const t of tables) {
    if (!t.kosis_org_id || !t.kosis_tbl_id) continue;
    byStat.set(t.statistic_id, [...(byStat.get(t.statistic_id) ?? []), t]);
  }

  const filled: Array<{ id: string; name: string; via: string; keys: number }> = [];
  const failed: string[] = [];
  const noTable: string[] = [];

  for (const s of missing) {
    const list = byStat.get(s.id) ?? [];
    if (list.length === 0) {
      noTable.push(s.name_ko);
      continue;
    }

    // 제목이 짧은 표가 대개 총괄표라 설명자료가 붙어 있을 확률이 높습니다.
    list.sort((a, b) => (a.table_name ?? '').length - (b.table_name ?? '').length);

    let got: unknown = null;
    let via = '';
    for (const t of list.slice(0, TRIES)) {
      try {
        const res = await fetchStatExplanation({
          orgId: t.kosis_org_id!,
          tblId: t.kosis_tbl_id!,
        });
        const meta = Array.isArray(res) ? res[0] : res;
        if (hasBody(meta)) {
          got = meta;
          via = `${t.kosis_org_id}/${t.kosis_tbl_id}`;
          break;
        }
      } catch (e) {
        log.warn(`  ${s.name_ko} ${t.kosis_tbl_id} 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (!got) {
      failed.push(`${s.name_ko} (표 ${list.length}개 시도)`);
      continue;
    }

    filled.push({
      id: s.id,
      name: s.name_ko,
      via,
      keys: Object.keys(got as Record<string, unknown>).length,
    });

    if (APPLY) {
      const { error } = await supabase
        .from('statistics')
        .update({ raw_meta: got, updated_at: new Date().toISOString() })
        .eq('id', s.id);
      if (error) throw error;
    }
  }

  log.info('');
  for (const f of filled) log.info(`  ✓ ${f.name} — 항목 ${f.keys}개 (${f.via})`);
  if (noTable.length > 0) log.warn(`통계표가 없어 부를 수 없는 조사 ${noTable.length}건: ${noTable.join(', ')}`);
  if (failed.length > 0) {
    log.warn(`설명자료를 못 받은 조사 ${failed.length}건:`);
    for (const f of failed) log.warn(`  ${f}`);
    log.warn('  KOSIS 에 설명자료가 없는 통계일 수 있습니다. 이건 CSV(21번)로 작성목적만 메웁니다.');
  }

  log.info('');
  log.info(`받아온 조사 ${filled.length}건 / 대상 ${missing.length}건`);
  if (!APPLY) {
    log.warn('--apply 를 붙이지 않아 DB 를 바꾸지 않았습니다.');
    return;
  }
  log.ok('반영 완료');
  log.info('다음: 11_applyAiContent(정제) → 12_buildOntology → 15_embed');
  log.info('  주요용어·유의사항이 새로 들어왔으니 개념과 혼동쌍이 늘어납니다.');
}

main().catch((e) => {
  log.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
