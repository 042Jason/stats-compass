/**
 * 온톨로지 → 엑셀 내보내기 (한글 우선)
 *
 * 검색에 쓰이는 노드·관계를 엑셀 한 권으로 뽑습니다. 사람이 고칠 만한 것만 담습니다.
 * 통계표(6,433)와 보도자료(310)는 뺍니다 — KOSIS·게시판에서 자동으로 끌어오는 것이라
 * 손으로 고쳐 봐야 다음 12_buildOntology 실행 때 덮어쓰입니다.
 *
 *   npx tsx src/seed/17_exportOntology.ts     → data/ontology.xlsx
 *
 * ── 한글 우선 배치
 * 읽고 고치는 칸(분류·이름·별칭·설명)을 왼쪽에 두고, 시스템이 쓰는 영문 식별자는
 * 맨 오른쪽 회색 칸으로 밀었습니다. 식별자를 없앨 수는 없습니다. `Survey`·`measuredBy`
 * 같은 값이 노드와 관계를 찾는 열쇠이기 때문입니다. 다만 볼 일은 없게 했습니다.
 *
 * ── 관계는 <이름>으로 적을 수 있습니다
 * 새 관계를 넣을 때 키를 몰라도 됩니다. 분류와 이름만 적으면 18 이 찾아냅니다.
 * 분류·관계 칸은 드롭다운이라 오타가 날 여지도 줄였습니다.
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import ExcelJS from 'exceljs';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

const OUT = 'data/ontology.xlsx';

/** 사람이 고칠 이유가 없는 클래스. 자동 생성분입니다. */
const SKIP_CLASSES = new Set(['StatisticalTable', 'NewsArticle']);
const SKIP_PROPS = new Set(['hasDistribution', 'mentionsSurvey', 'mentionsIndicator']);

const FONT = { name: 'Arial', size: 10 };
const HEAD = 'FFEEF3FA';
const LOCK = 'FFF3F5F8';
const HINT = 'FFFFF9E6';

interface EntRow {
  id: string;
  class_id: string;
  key: string;
  label: string;
  alt_labels: string[] | null;
  description: string | null;
  props: Record<string, unknown> | null;
}
interface RelRow {
  property_id: string;
  source_id: string;
  target_id: string;
  evidence: string | null;
}

/** PostgREST 는 한 번에 1000행까지만 줍니다. 정렬 없이 나누면 행이 새거나 겹칩니다. */
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

function head(ws: ExcelJS.Worksheet, locked: number[]): void {
  const row = ws.getRow(1);
  row.font = { ...FONT, bold: true };
  row.eachCell((cell, col) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: locked.includes(col) ? LOCK : HEAD },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD6DBE4' } } };
  });
  row.height = 30;
}

async function main() {
  const [classes, props, ents, rels] = await Promise.all([
    pageAll<{ id: string; label: string; description: string | null; std_prefix: string | null; std_uri: string | null }>(
      (f, t) => supabase.from('ontology_classes').select('id, label, description, std_prefix, std_uri').order('sort_order').range(f, t),
    ),
    pageAll<{ id: string; label: string; description: string | null; domain_class: string | null; range_class: string | null }>(
      (f, t) => supabase.from('ontology_properties').select('id, label, description, domain_class, range_class').order('sort_order').range(f, t),
    ),
    pageAll<EntRow>((f, t) =>
      supabase.from('ontology_entities').select('id, class_id, key, label, alt_labels, description, props').order('id').range(f, t),
    ),
    pageAll<RelRow>((f, t) =>
      supabase.from('ontology_relations').select('property_id, source_id, target_id, evidence').order('id').range(f, t),
    ),
  ]);

  const keep = ents.filter((e) => !SKIP_CLASSES.has(e.class_id));
  const byId = new Map(ents.map((e) => [e.id, e]));
  const kept = new Set(keep.map((e) => e.id));
  const keptRels = rels.filter(
    (r) => !SKIP_PROPS.has(r.property_id) && kept.has(r.source_id) && kept.has(r.target_id),
  );

  /* 영문 식별자 → 한글 라벨. 중복 라벨이 있으면 뒤에 식별자를 붙여 구분합니다. */
  const clsSeen = new Map<string, number>();
  for (const c of classes) clsSeen.set(c.label, (clsSeen.get(c.label) ?? 0) + 1);
  const clsKo = new Map(
    classes.map((c) => [c.id, (clsSeen.get(c.label) ?? 0) > 1 ? `${c.label} (${c.id})` : c.label]),
  );

  const propSeen = new Map<string, number>();
  for (const p of props) propSeen.set(p.label, (propSeen.get(p.label) ?? 0) + 1);
  const propKo = new Map(
    props.map((p) => [p.id, (propSeen.get(p.label) ?? 0) > 1 ? `${p.label} (${p.id})` : p.label]),
  );

  /* 실제로 쓰인 클래스·프로퍼티만 드롭다운에 올립니다. 안 쓰는 걸 보여 줘도 혼란만 줍니다. */
  const usedCls = [...new Set(keep.map((e) => e.class_id))].sort();
  const usedProp = [...new Set(keptRels.map((r) => r.property_id))].sort();

  log.info(`노드 ${ents.length}건 중 ${keep.length}건 · 관계 ${rels.length}건 중 ${keptRels.length}건 내보냄`);

  const wb = new ExcelJS.Workbook();
  wb.creator = '생애나침반';
  wb.created = new Date();

  /* ── 읽어보기 ─────────────────────────────────────────────── */
  const help = wb.addWorksheet('읽어보기');
  help.columns = [{ width: 20 }, { width: 104 }];
  const lines: Array<[string, string]> = [
    ['이 파일은', '생애나침반 검색이 쓰는 노드와 관계입니다. 고쳐서 되돌려 넣으면 검색 결과가 바뀝니다.'],
    ['', ''],
    ['고쳐도 되는 칸', '노드 시트 — 이름 · 별칭 · 설명'],
    ['', '관계 시트 — 행을 새로 추가하면 새 관계가 생깁니다'],
    ['', ''],
    ['건드리면 안 되는 칸', '맨 오른쪽 회색 칸(영문 식별자 · 키 · 속성).'],
    ['', '이 값들이 노드를 찾는 열쇠입니다. 바꾸면 다른 노드로 인식해 반영이 안 됩니다.'],
    ['', '읽을 일은 없으니 그냥 두시면 됩니다.'],
    ['', ''],
    ['별칭 적는 법', '쉼표로 구분합니다.    예)   월급 얼마, 봉급, 실수령액'],
    ['', ''],
    ['', '★ 별칭이 검색에서 가장 크게 작용합니다.'],
    ['', '   "월급 얼마" 처럼 짧은 구어체를 넣어 두면 어휘 검색이 그것만으로 노드를 찾습니다.'],
    ['', '   문장 전체를 비교하는 벡터 검색은 짧은 말을 못 잡습니다. 그래서 별칭이 필요합니다.'],
    ['', '   잘 안 잡히는 표현이 있으면 그 조사·지표 행의 별칭 칸에 그대로 적어 주세요.'],
    ['', ''],
    ['관계 새로 넣기', '관계 시트에 행을 추가하고 <관계> <출발 분류> <출발 이름> <도착 분류> <도착 이름> 만 채우면 됩니다.'],
    ['', '키는 몰라도 됩니다. 이름으로 찾아냅니다. 분류·관계 칸은 드롭다운입니다.'],
    ['', ''],
    ['행을 지우면', '아무 일도 없습니다. DB 에 그대로 남습니다.'],
    ['', '지우려면 <삭제> 칸에 Y 를 적으세요. 실수로 행을 날려도 데이터가 사라지지 않게 한 것입니다.'],
    ['', ''],
    ['빠져 있는 것', '통계표 6,433건과 보도자료 310건은 뺐습니다. KOSIS·게시판에서 자동으로 끌어오는'],
    ['', '것이라 손으로 고쳐도 다음 재빌드 때 덮어쓰입니다.'],
    ['', ''],
    ['되돌려 넣는 법', '① npx tsx src/seed/18_applyOntologyEdits.ts             무엇이 바뀌는지 보기만 함'],
    ['', '② npx tsx src/seed/18_applyOntologyEdits.ts --apply     실제로 반영'],
    ['', '③ npx tsx src/seed/15_embed.ts                          별칭·설명을 고쳤으면 필수'],
    ['', ''],
    ['③을 빠뜨리면', '검색에 반영되지 않습니다. 별칭은 임베딩으로 찾기 때문입니다.'],
  ];
  lines.forEach(([a, b]) => {
    const r = help.addRow([a, b]);
    r.font = FONT;
    r.getCell(1).font = { ...FONT, bold: true };
    if (a.startsWith('★') || b.startsWith('★')) r.font = { ...FONT, bold: true };
  });

  /* ── 목록 (드롭다운 원본) ─────────────────────────────────── */
  const lst = wb.addWorksheet('목록');
  lst.columns = [{ header: '분류', width: 24 }, { header: '관계', width: 24 }];
  head(lst, []);
  const maxLen = Math.max(usedCls.length, usedProp.length);
  for (let i = 0; i < maxLen; i++) {
    const r = lst.addRow([
      usedCls[i] ? (clsKo.get(usedCls[i]) ?? usedCls[i]) : '',
      usedProp[i] ? (propKo.get(usedProp[i]) ?? usedProp[i]) : '',
    ]);
    r.font = FONT;
  }
  lst.state = 'hidden';

  const clsRange = `목록!$A$2:$A$${usedCls.length + 1}`;
  const propRange = `목록!$B$2:$B$${usedProp.length + 1}`;

  /* ── 노드 ─────────────────────────────────────────────────── */
  const ws = wb.addWorksheet('노드', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ws.columns = [
    { header: '분류', key: 'clsko', width: 18 },
    { header: '이름', key: 'label', width: 34 },
    { header: '별칭 (쉼표로 구분)', key: 'alt', width: 54 },
    { header: '설명', key: 'desc', width: 62 },
    { header: '삭제\n(Y)', key: 'del', width: 7 },
    { header: '식별자', key: 'cls', width: 16 },
    { header: '키', key: 'key', width: 30 },
    { header: '속성', key: 'props', width: 34 },
  ];
  head(ws, [6, 7, 8]);

  keep
    .sort((a, b) => a.class_id.localeCompare(b.class_id) || a.label.localeCompare(b.label, 'ko'))
    .forEach((e) => {
      const r = ws.addRow({
        clsko: clsKo.get(e.class_id) ?? e.class_id,
        label: e.label,
        alt: (e.alt_labels ?? []).join(', '),
        desc: e.description ?? '',
        del: '',
        cls: e.class_id,
        key: e.key,
        props: JSON.stringify(e.props ?? {}),
      });
      r.font = FONT;
      r.alignment = { vertical: 'top', wrapText: false };
      for (const c of [6, 7, 8]) {
        r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOCK } };
        r.getCell(c).font = { ...FONT, color: { argb: 'FF8A94A0' } };
      }
      r.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HINT } };
    });
  ws.autoFilter = { from: 'A1', to: 'H1' };

  /* ── 관계 ─────────────────────────────────────────────────── */
  const rw = wb.addWorksheet('관계', { views: [{ state: 'frozen', ySplit: 1 }] });
  rw.columns = [
    { header: '관계', key: 'propko', width: 20 },
    { header: '출발 분류', key: 'scls', width: 15 },
    { header: '출발 이름', key: 'sname', width: 30 },
    { header: '도착 분류', key: 'tcls', width: 15 },
    { header: '도착 이름', key: 'tname', width: 30 },
    { header: '근거', key: 'ev', width: 58 },
    { header: '삭제\n(Y)', key: 'del', width: 7 },
    { header: '식별자', key: 'prop', width: 18 },
    { header: '출발 키', key: 'skey', width: 26 },
    { header: '도착 키', key: 'tkey', width: 26 },
  ];
  head(rw, [8, 9, 10]);

  keptRels
    .map((r) => ({ r, s: byId.get(r.source_id)!, t: byId.get(r.target_id)! }))
    .sort(
      (a, b) =>
        a.r.property_id.localeCompare(b.r.property_id) || a.s.label.localeCompare(b.s.label, 'ko'),
    )
    .forEach(({ r, s, t }) => {
      const row = rw.addRow({
        propko: propKo.get(r.property_id) ?? r.property_id,
        scls: clsKo.get(s.class_id) ?? s.class_id,
        sname: s.label,
        tcls: clsKo.get(t.class_id) ?? t.class_id,
        tname: t.label,
        ev: r.evidence ?? '',
        del: '',
        prop: r.property_id,
        skey: s.key,
        tkey: t.key,
      });
      row.font = FONT;
      row.alignment = { vertical: 'top' };
      for (const c of [8, 9, 10]) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOCK } };
        row.getCell(c).font = { ...FONT, color: { argb: 'FF8A94A0' } };
      }
    });
  rw.autoFilter = { from: 'A1', to: 'J1' };

  /* 드롭다운 — 기존 행 + 새로 적을 여유분 200줄 */
  const lastRel = rw.rowCount + 200;
  for (let n = 2; n <= lastRel; n++) {
    rw.getCell(`A${n}`).dataValidation = { type: 'list', allowBlank: true, formulae: [propRange] };
    rw.getCell(`B${n}`).dataValidation = { type: 'list', allowBlank: true, formulae: [clsRange] };
    rw.getCell(`D${n}`).dataValidation = { type: 'list', allowBlank: true, formulae: [clsRange] };
  }
  for (let n = 2; n <= ws.rowCount; n++) {
    ws.getCell(`E${n}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Y"'] };
  }

  /* ── 참고 시트 ────────────────────────────────────────────── */
  const cw = wb.addWorksheet('분류 목록 (참고)');
  cw.columns = [
    { header: '분류', width: 20 },
    { header: '개수', width: 8 },
    { header: '설명', width: 76 },
    { header: '표준', width: 44 },
    { header: '식별자', width: 18 },
  ];
  head(cw, [5]);
  const cnt = new Map<string, number>();
  for (const e of ents) cnt.set(e.class_id, (cnt.get(e.class_id) ?? 0) + 1);
  classes.forEach((c) => {
    const r = cw.addRow([
      clsKo.get(c.id) ?? c.id,
      cnt.get(c.id) ?? 0,
      c.description ?? '',
      [c.std_prefix, c.std_uri].filter(Boolean).join(' · '),
      c.id,
    ]);
    r.font = FONT;
    r.getCell(5).font = { ...FONT, color: { argb: 'FF8A94A0' } };
  });

  const pw = wb.addWorksheet('관계 목록 (참고)');
  pw.columns = [
    { header: '관계', width: 20 },
    { header: '무엇에서 무엇으로', width: 34 },
    { header: '건수', width: 8 },
    { header: '설명', width: 76 },
    { header: '식별자', width: 20 },
  ];
  head(pw, [5]);
  const pcnt = new Map<string, number>();
  for (const r of rels) pcnt.set(r.property_id, (pcnt.get(r.property_id) ?? 0) + 1);
  props.forEach((p) => {
    const r = pw.addRow([
      propKo.get(p.id) ?? p.id,
      `${clsKo.get(p.domain_class ?? '') ?? '?'} → ${clsKo.get(p.range_class ?? '') ?? '?'}`,
      pcnt.get(p.id) ?? 0,
      p.description ?? '',
      p.id,
    ]);
    r.font = FONT;
    r.getCell(5).font = { ...FONT, color: { argb: 'FF8A94A0' } };
  });

  mkdirSync(dirname(OUT), { recursive: true });
  await wb.xlsx.writeFile(OUT);
  log.ok(`${OUT} 저장 — 노드 ${keep.length} · 관계 ${keptRels.length}`);
  log.info('고친 뒤: npx tsx src/seed/18_applyOntologyEdits.ts --apply');
}

main().catch((e) => {
  log.err(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e, null, 2));
  process.exit(1);
});
