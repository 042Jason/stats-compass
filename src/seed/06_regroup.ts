/**
 * 조사 단위 재그룹핑 + 태그 생성
 *
 * 배경
 *   기존 statistics 는 KOSIS 분류트리의 '말단 폴더'를 조사로 오인해 만들어졌습니다.
 *   (107건 중 76건이 실제 조사명과 불일치 — '전체대상', '가공통계', '총조사주택(1990년)' 등)
 *   조사명은 통계설명자료의 statsNm 에만 있으므로, 로컬 data/seed/02_meta.json 을 근거로
 *   1,378개 통계표를 52개 조사로 다시 묶습니다.
 *
 * 하는 일
 *   1) 02_meta.json 으로 (org_id, tbl_id) -> 조사명·메타 매핑
 *   2) 조사별 statistics 행 upsert (태그·작성기관 복원 포함)
 *   3) statistic_tables 전체 upsert — 로컬에만 있는 새 통계표도 DB 에 넣습니다
 *      (예전 버전은 이미 DB 에 있는 표의 소속만 바꿔서, 새로 크롤링한
 *       11,153건 중 1,381건만 반영되는 문제가 있었습니다)
 *   4) statistic_history / statistic_events / deep_dive_articles / curated_set_items 의
 *      statistic_id 도 옮긴 조사로 재연결
 *   5) 통계표가 하나도 남지 않은 옛 행은 삭제하지 않고 status='merged' 로만 표시
 *      (수기로 넣은 데이터·외래키를 보존하기 위함)
 *
 * 실행:
 *   npx tsx src/seed/06_regroup.ts --dry-run   # 계획만 출력
 *   npx tsx src/seed/06_regroup.ts             # 실제 반영
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';
import { surveyName, toStatId, guessCategory, normalizeCategory } from '../utils/survey.js';
import { buildTags } from '../utils/tags.js';
import { repairOrgName } from '../utils/agency.js';

const META_FILE = 'data/seed/02_meta.json';
const DRY = process.argv.includes('--dry-run');

interface MetaRow {
  org_id: string;
  tbl_id: string;
  tbl_nm?: string;
  survey_name?: string;
  category_path?: string;
  meta?: Record<string, unknown> | null;
}

interface DbTable {
  id: string;
  statistic_id: string | null;
  kosis_org_id: string | null;
  kosis_tbl_id: string | null;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const key = (org: string, tbl: string) => `${org}:${tbl}`;

/** 가장 자주 등장한 값 */
function mode(values: string[]): string {
  const c = new Map<string, number>();
  for (const v of values) if (v) c.set(v, (c.get(v) ?? 0) + 1);
  let best = '';
  let n = 0;
  for (const [v, k] of c) if (k > n) { best = v; n = k; }
  return best;
}

/** 'YYYYMMDD' -> 'YYYY-MM-DD' (date 컬럼용). 형식이 다르면 null */
function toDate(v: unknown): string | null {
  const m = str(v).match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function main() {
  const metaRows: MetaRow[] = JSON.parse(readFileSync(META_FILE, 'utf-8'));
  log.info(`로컬 메타 ${metaRows.length}건 로드`);

  const byTable = new Map<string, MetaRow>();
  for (const r of metaRows) byTable.set(key(r.org_id, r.tbl_id), r);

  // --- DB 통계표 전량 로드 -------------------------------------------------
  const dbTables: DbTable[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('statistic_tables')
      .select('id, statistic_id, kosis_org_id, kosis_tbl_id')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    dbTables.push(...(data as DbTable[]));
    if (data.length < 1000) break;
  }
  log.info(`DB 통계표 ${dbTables.length}건`);

  // --- 조사별로 묶기 -------------------------------------------------------
  // ★ 그룹핑 기준은 '로컬 메타 전체' 입니다.
  //   DB 에 있는 표만 훑으면 새로 크롤링한 표가 통째로 빠집니다.
  interface Group { name: string; tables: DbTable[]; metas: MetaRow[] }
  const groups = new Map<string, Group>();
  for (const m of metaRows) {
    const name = surveyName(m);
    if (!groups.has(name)) groups.set(name, { name, tables: [], metas: [] });
    groups.get(name)!.metas.push(m);
  }
  const localKeys = new Set(metaRows.map((m) => key(m.org_id, m.tbl_id)));
  const orphanTables = dbTables.filter(
    (t) => !(t.kosis_org_id && t.kosis_tbl_id && localKeys.has(key(t.kosis_org_id, t.kosis_tbl_id))),
  );
  log.info(`조사 ${groups.size}개 / 통계표 ${metaRows.length}건 (DB 에만 있는 표 ${orphanTables.length}건은 그대로 둠)`);

  // --- 조사 행 만들기 ------------------------------------------------------
  const rows = [...groups.values()].map((g) => {
    // 메타가 가장 풍부한 표를 대표로
    const rep = [...g.metas].sort(
      (a, b) => Object.keys(b.meta ?? {}).length - Object.keys(a.meta ?? {}).length,
    )[0];
    const meta = (rep.meta ?? {}) as Record<string, unknown>;
    // 기관별 트리의 category_path 는 '조사 > 하위분류' 라 주제 분류가 아닙니다.
    // 통계설명자료의 statsField(통계 분야)를 우선 쓰고, 없으면 경로 첫 마디로 대체합니다.
    // statsField 는 '노동/사회일반' 처럼 복합값이 오기도 해서 첫 분야만 씁니다.
    // 조사 안의 여러 표를 모아 최빈값을 뽑으므로 일부 표에 값이 없어도 채워집니다.
    // 1) 통계설명자료의 statsField(복합값이면 첫 분야만)
    // 2) 없으면 조사명으로 추정 — 52개 중 17개가 statsField 가 비어 있습니다
    // 3) 그래도 없으면 분류경로 첫 마디
    const fromField = mode(g.metas.map((m) => str((m.meta ?? {}).statsField).split('/')[0].trim()));
    const category = normalizeCategory(
      fromField || guessCategory(g.name) || mode(g.metas.map((m) => str(m.category_path).split(' > ')[0])),
    );

    return {
      stat_id: toStatId(g.name),
      name_ko: g.name,
      agency: repairOrgName(str(meta.MAINC_NM)) ?? '국가데이터처',
      org_id: rep.org_id,
      category,
      legal_basis: str(meta.LAWFUL_BAS ?? meta.basisLaw) || null,
      purpose: str(meta.PRP_CNT ?? meta.writingPurps) || null,
      target: str(meta.STATS_TARGET ?? meta.examinObjrange) || null,
      method: str(meta.RESN_TXT ?? meta.dataCollectMth) || null,
      frequency: str(meta.COLLECT_CYCLE ?? meta.statsPeriod) || null,
      approval_date: toDate(meta.confmDt),
      tags: buildTags({ name: g.name, category, meta }),
      raw_meta: meta,
      status: 'active',
      _tables: g.tables,
      _metas: g.metas,
    };
  });

  rows.sort((a, b) => b._metas.length - a._metas.length);
  log.ok(`조사 ${rows.length}개 구성 (통계표 ${rows.reduce((n, r) => n + r._metas.length, 0)}건)`);
  rows.slice(0, 10).forEach((r) =>
    log.info(`  ${String(r._metas.length).padStart(5)}표  ${r.name_ko}  [${r.category}]  #${r.tags.join(' #')}`),
  );

  if (DRY) {
    log.warn('--dry-run 이므로 DB 를 수정하지 않았습니다.');
    return;
  }

  // --- upsert --------------------------------------------------------------
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(({ _tables, _metas, ...rest }) => rest);
    const { error } = await supabase.from('statistics').upsert(batch, { onConflict: 'stat_id' });
    if (error) throw error;
  }
  log.ok('statistics upsert 완료');

  const { data: idRows, error: idErr } = await supabase.from('statistics').select('id, stat_id');
  if (idErr) throw idErr;
  const idByStatId = new Map((idRows ?? []).map((r) => [r.stat_id as string, r.id as string]));

  // --- 통계표 upsert + 소속 연결 -------------------------------------------
  //  로컬(02_meta.json)에 있는 모든 통계표를 DB 에 반영합니다.
  //  onConflict 가 (kosis_org_id, kosis_tbl_id) 라 이미 있는 표는 갱신됩니다.
  const oldToNew = new Map<string, Map<string, number>>(); // oldStatisticId -> newId -> 표 수
  const existingByKey = new Map<string, DbTable>();
  for (const t of dbTables) {
    if (t.kosis_org_id && t.kosis_tbl_id) existingByKey.set(key(t.kosis_org_id, t.kosis_tbl_id), t);
  }

  const tableRows: Record<string, unknown>[] = [];
  for (const r of rows) {
    const newId = idByStatId.get(r.stat_id);
    if (!newId) { log.warn(`id 없음: ${r.stat_id}`); continue; }

    r._metas.forEach((m, idx) => {
      const k = key(m.org_id, m.tbl_id);
      const prev = existingByKey.get(k);
      if (prev?.statistic_id) {
        if (!oldToNew.has(prev.statistic_id)) oldToNew.set(prev.statistic_id, new Map());
        const c = oldToNew.get(prev.statistic_id)!;
        c.set(newId, (c.get(newId) ?? 0) + 1);
      }
      tableRows.push({
        statistic_id: newId,
        kosis_org_id: m.org_id,
        kosis_tbl_id: m.tbl_id,
        table_name: m.tbl_nm ?? '',
        category_path: m.category_path ?? '',
        is_representative: idx === 0,
        display_order: idx,
        kosis_url: `https://kosis.kr/statHtml/statHtml.do?orgId=${m.org_id}&tblId=${m.tbl_id}&conn_path=I3`,
      });
    });
  }

  const TBATCH = 500;
  for (let i = 0; i < tableRows.length; i += TBATCH) {
    const batch = tableRows.slice(i, i + TBATCH);
    const { error } = await supabase
      .from('statistic_tables')
      .upsert(batch, { onConflict: 'kosis_org_id,kosis_tbl_id' });
    if (error) throw error;
    if ((i / TBATCH) % 4 === 0) log.info(`통계표 ${Math.min(i + TBATCH, tableRows.length)}/${tableRows.length}`);
  }
  log.ok(`통계표 ${tableRows.length}건 upsert 완료`);

  // --- 부속 데이터 재연결 (표가 가장 많이 옮겨간 조사로) ----------------------
  const successor = new Map<string, string>();
  for (const [oldId, counts] of oldToNew) {
    let best = '';
    let n = 0;
    for (const [newId, c] of counts) if (c > n) { best = newId; n = c; }
    if (best && best !== oldId) successor.set(oldId, best);
  }

  for (const table of ['statistic_history', 'statistic_events', 'deep_dive_articles', 'curated_set_items'] as const) {
    let n = 0;
    for (const [oldId, newId] of successor) {
      const { error, count } = await supabase
        .from(table)
        .update({ statistic_id: newId }, { count: 'exact' })
        .eq('statistic_id', oldId);
      if (error) { log.warn(`${table} 재연결 건너뜀: ${error.message}`); break; }
      n += count ?? 0;
    }
    if (n > 0) log.ok(`${table} ${n}건 재연결`);
  }

  // --- 남은 옛 행 표시 -----------------------------------------------------
  const keepIds = new Set([...idByStatId.entries()].filter(([sid]) => rows.some((r) => r.stat_id === sid)).map(([, id]) => id));
  const stale = [...successor.keys()].filter((id) => !keepIds.has(id));
  for (let i = 0; i < stale.length; i += BATCH) {
    await Promise.all(
      stale.slice(i, i + BATCH).map((id) =>
        supabase.from('statistics').update({ status: 'merged' }).eq('id', id),
      ),
    );
  }
  log.ok(`옛 조사 ${stale.length}건을 status='merged' 로 표시 (삭제하지 않음)`);

  const { count: active } = await supabase
    .from('statistics')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  log.ok(`최종 — active 조사 ${active}건`);
}

main().catch((e) => { log.err('Fatal', e); process.exit(1); });
