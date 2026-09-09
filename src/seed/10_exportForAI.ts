/**
 * AI 정제용 추출본 만들기
 *
 * 02_meta.json 은 20MB 가 넘어 그대로 검토하기 어렵습니다.
 * 조사(69개) 단위로 필요한 항목만, 길이를 잘라 압축본을 만듭니다.
 *
 *   npx tsx src/seed/10_exportForAI.ts
 *   -> data/seed/10_ai_input.json   (수백 KB)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { EnrichedTable } from '../types.js';
import { log } from '../utils/logger.js';
import { surveyName, toStatId, guessCategory, normalizeCategory } from '../utils/survey.js';

const IN_FILE = 'data/seed/02_meta.json';
const OUT_FILE = 'data/seed/10_ai_input.json';

const clean = (v: unknown, max = 0): string => {
  let s = String(v ?? '');
  // KOSIS 는 HTML 엔티티가 이중 이스케이프되어 옵니다
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
      .replace(/&times;/g, '×').replace(/&sim;/g, '~');
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (['-', '없음', '해당없음', '해당 없음', '미해당'].includes(s)) return '';
  return max > 0 && s.length > max ? s.slice(0, max) + '…' : s;
};

function main() {
  const rows: EnrichedTable[] = JSON.parse(readFileSync(IN_FILE, 'utf-8'));

  const groups = new Map<string, EnrichedTable[]>();
  for (const t of rows) {
    const n = surveyName(t);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n)!.push(t);
  }

  const out = [...groups.entries()].map(([name, list]) => {
    const rep = [...list].sort(
      (a, b) => Object.keys(b.meta ?? {}).length - Object.keys(a.meta ?? {}).length,
    )[0];
    const m = (rep.meta ?? {}) as Record<string, unknown>;
    const fields = (m.statsField ? String(m.statsField) : '').split('/')[0].trim();

    return {
      stat_id: toStatId(name),
      name,
      category: normalizeCategory(fields || guessCategory(name)),
      tables: list.length,
      hasMeta: Object.keys(m).length > 0,
      // 개요를 쓰기 위한 근거들
      purpose: clean(m.PRP_CNT ?? m.writingPurps, 600),
      target: clean(m.STATS_TARGET ?? m.examinObjrange, 500),
      method: clean(m.RESN_TXT ?? m.dataCollectMth, 200),
      frequency: clean(m.COLLECT_CYCLE ?? m.statsPeriod, 40),
      area: clean(m.examinObjArea, 60),
      kind: clean(m.statsKind, 40),
      unit: clean(m.josaUnit, 250),
      items: clean(m.josaItm, 400),
      legal: clean(m.LAWFUL_BAS ?? m.basisLaw, 120),
      // 쉽게 풀어 쓸 대상
      terms: clean(m.mainTermExpl, 1600),
      cautions: clean(m.dataUserNote, 900),
      // 참고용
      history: clean(m.examinHistory, 300),
      sampleTables: list.slice(0, 5).map((t) => clean(t.tbl_nm, 60)),
    };
  });

  out.sort((a, b) => b.tables - a.tables);
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 1), 'utf-8');

  const noMeta = out.filter((o) => !o.hasMeta);
  const noPurpose = out.filter((o) => !o.purpose);
  log.ok(`조사 ${out.length}개 -> ${OUT_FILE}`);
  log.info(`  메타 없음 ${noMeta.length}개: ${noMeta.map((o) => o.name).join(', ') || '-'}`);
  log.info(`  조사목적 없음 ${noPurpose.length}개: ${noPurpose.map((o) => o.name).join(', ') || '-'}`);
  log.info(`  주요용어 있음 ${out.filter((o) => o.terms).length}개 / 유의사항 있음 ${out.filter((o) => o.cautions).length}개`);
}

main();
