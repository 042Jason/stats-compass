/**
 * 검토한 엑셀 → 13_conceptsExtra.json 반영
 *
 *   npx tsx src/seed/20_applyConceptReview.ts            무엇이 바뀌는지 보기만
 *   npx tsx src/seed/20_applyConceptReview.ts --apply    실제 반영
 *
 * 그 다음 12_buildOntology → 15_embed 순으로 돌리면 검색에 들어갑니다.
 *
 * ── 규칙
 *   판정 X        그 항목을 뺍니다
 *   판정 보류      status 를 '보류' 로 바꿔 그래프에 안 올립니다 (지우지는 않습니다)
 *   판정 O / 빈칸  살립니다
 *   정의·별칭·왜   엑셀에 적힌 값을 그대로 씁니다
 *
 * 사람이 문장을 고쳤으면 status 를 '검토' 로 올립니다. 제가 쓴 초안과
 * 사람이 확인한 문장은 구분돼야 합니다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { log } from '../utils/logger.js';

const XLSX = 'data/개념_검토.xlsx';
const JSONF = 'data/seed/13_conceptsExtra.json';
const APPLY = process.argv.includes('--apply');

const s = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text ?? '').trim();
  if (typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result ?? '').trim();
  return String(v).trim();
};
const splitAlts = (v: string): string[] =>
  v.split(',').map((x) => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);

interface Concept {
  key: string; label: string; group?: string; status?: string;
  definition?: string; alt?: string[]; source?: string;
}
interface Confusion { a: string; b: string; why?: string; status?: string; source?: string }
interface Related { a: string; b: string }
interface File { concepts: Concept[]; confusions: Confusion[]; related: Related[]; [k: string]: unknown }

async function main() {
  const data = JSON.parse(readFileSync(JSONF, 'utf8')) as File;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);

  const changes: string[] = [];
  let dropped = 0;
  let held = 0;
  let edited = 0;

  /* ── 개념 ──────────────────────────────────────────── */
  const cw = wb.getWorksheet('개념');
  if (!cw) throw new Error(`${XLSX} 에 "개념" 시트가 없습니다`);
  const byKey = new Map(data.concepts.map((c) => [c.key, c]));
  const keepConcepts = new Set<string>();

  cw.eachRow((row, n) => {
    if (n === 1) return;
    // 분야 개념 상태 정의 별칭 판정 메모 출처 키
    const key = s(row.getCell(9).value);
    const c = byKey.get(key);
    if (!c) return;

    const verdictV = s(row.getCell(6).value).toUpperCase();
    if (verdictV === 'X') {
      dropped++;
      changes.push(`− 개념 제외: ${c.label}`);
      return;
    }
    keepConcepts.add(key);

    const def = s(row.getCell(4).value);
    const alt = splitAlts(s(row.getCell(5).value));
    const memo = s(row.getCell(7).value);
    let touched = false;

    if (def && def !== (c.definition ?? '')) {
      c.definition = def;
      changes.push(`  정의 수정: ${c.label}`);
      touched = true;
    }
    if (alt.join(' ') !== (c.alt ?? []).join(' ')) {
      c.alt = alt;
      changes.push(`  별칭 수정: ${c.label} (${(c.alt ?? []).length}개)`);
      touched = true;
    }
    if (memo) (c as Record<string, unknown>).memo = memo;

    if (verdictV === '보류') {
      c.status = '보류';
      held++;
    } else if (touched && c.status !== '확인') {
      // 사람이 손댄 문장은 제 초안과 구분합니다.
      c.status = '검토';
    }
    if (touched) edited++;
  });

  data.concepts = data.concepts.filter((c) => keepConcepts.has(c.key));

  /* ── 혼동쌍 ────────────────────────────────────────── */
  const fw = wb.getWorksheet('혼동쌍');
  const keepConf = new Set<string>();
  const pairKey = (a: string, b: string) => `${a}|${b}`;
  const confByKey = new Map(data.confusions.map((p) => [pairKey(p.a, p.b), p]));

  fw?.eachRow((row, n) => {
    if (n === 1) return;
    // A B 상태 왜 판정 메모 출처 키A 키B
    const ka = s(row.getCell(8).value);
    const kb = s(row.getCell(9).value);
    const p = confByKey.get(pairKey(ka, kb));
    if (!p) return;

    const verdictV = s(row.getCell(5).value).toUpperCase();
    if (verdictV === 'X') {
      dropped++;
      changes.push(`− 혼동쌍 제외: ${ka} ↔ ${kb}`);
      return;
    }
    keepConf.add(pairKey(ka, kb));

    const why = s(row.getCell(4).value);
    if (why && why !== (p.why ?? '')) {
      p.why = why;
      if (p.status !== '확인') p.status = '검토';
      changes.push(`  혼동 사유 수정: ${ka} ↔ ${kb}`);
      edited++;
    }
    const memo = s(row.getCell(6).value);
    if (memo) (p as Record<string, unknown>).memo = memo;
    if (verdictV === '보류') {
      p.status = '보류';
      held++;
    }
  });
  data.confusions = data.confusions.filter((p) => keepConf.has(pairKey(p.a, p.b)));

  /* ── 연관쌍 ────────────────────────────────────────── */
  const rw = wb.getWorksheet('연관쌍');
  const keepRel = new Set<string>();
  rw?.eachRow((row, n) => {
    if (n === 1) return;
    const ka = s(row.getCell(5).value);
    const kb = s(row.getCell(6).value);
    if (!ka || !kb) return;
    if (s(row.getCell(3).value).toUpperCase() === 'X') {
      dropped++;
      changes.push(`− 연관쌍 제외: ${ka} ↔ ${kb}`);
      return;
    }
    keepRel.add(pairKey(ka, kb));
  });
  data.related = data.related.filter((p) => keepRel.has(pairKey(p.a, p.b)));

  /* 개념이 빠지면 그 개념을 물고 있던 관계도 같이 빠져야 합니다.
   * 안 그러면 12_buildOntology 가 "개념이 없습니다" 경고를 쏟아냅니다. */
  const alive = new Set(data.concepts.map((c) => c.key));
  const beforeC = data.confusions.length;
  const beforeR = data.related.length;
  data.confusions = data.confusions.filter((p) => alive.has(p.a) && alive.has(p.b));
  data.related = data.related.filter((p) => alive.has(p.a) && alive.has(p.b));
  const orphan = beforeC - data.confusions.length + (beforeR - data.related.length);

  /* ── 보고 ──────────────────────────────────────────── */
  log.info('');
  for (const c of changes.slice(0, 60)) log.info(c);
  if (changes.length > 60) log.info(`… 외 ${changes.length - 60}건`);
  log.info('');
  log.info(`제외 ${dropped} · 보류 ${held} · 수정 ${edited} · 개념이 빠져 함께 제외된 관계 ${orphan}`);
  log.info(
    `남는 것 — 개념 ${data.concepts.length} · 혼동쌍 ${data.confusions.length} · 연관쌍 ${data.related.length}`,
  );
  const byStatus = new Map<string, number>();
  for (const c of data.concepts) byStatus.set(c.status ?? '미확인', (byStatus.get(c.status ?? '미확인') ?? 0) + 1);
  log.info(`상태 — ${[...byStatus].map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  if (!APPLY) {
    log.warn('--apply 를 붙이지 않아 아무것도 바꾸지 않았습니다.');
    return;
  }

  writeFileSync(JSONF, JSON.stringify(data, null, 2), 'utf8');
  log.ok(`${JSONF} 저장`);
  log.info('다음: npx tsx src/seed/12_buildOntology.ts  →  npx tsx src/seed/15_embed.ts');
}

main().catch((e) => {
  log.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
