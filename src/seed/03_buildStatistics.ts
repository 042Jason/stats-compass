/**
 * 통계표를 조사(statistic) 단위로 그룹핑
 * KOSIS API의 stat_nm이 비어있는 경우 category_path 마지막 요소 사용
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { EnrichedTable, BuiltStatistic } from '../types.js';
import { log } from '../utils/logger.js';
import { repairOrgName } from '../utils/agency.js';
import { surveyName, toStatId } from '../utils/survey.js';
import { buildTags } from '../utils/tags.js';

const IN_FILE = 'data/seed/02_meta.json';
const OUT_FILE = 'data/seed/03_statistics.json';


function topCategory(path: string): string {
  return path.split(' > ')[0] ?? '';
}

/** 조사명 도출: stat_nm 우선, 없으면 category_path 마지막 요소 */
function deriveStatName(t: EnrichedTable): string {
  if (t.stat_nm && t.stat_nm.trim().length > 0) {
    return t.stat_nm.trim();
  }
  const parts = t.category_path.split(' > ').filter(p => p.length > 0);
  if (parts.length === 0) return '(unknown)';
  return parts[parts.length - 1];
}

function main() {
  const enriched: EnrichedTable[] = JSON.parse(readFileSync(IN_FILE, 'utf-8'));
  log.info(`Building statistics from ${enriched.length} tables`);

  // 조사명 별 그룹핑
  const groups = new Map<string, EnrichedTable[]>();
  for (const t of enriched) {
    const key = deriveStatName(t);
    if (key === '(unknown)') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const built: BuiltStatistic[] = [];
  for (const [statNm, ts] of groups) {
    // 대표 통계표: 카테고리 경로가 가장 짧은 것 (총괄표 성격)
    const sorted = [...ts].sort((a, b) => a.category_path.length - b.category_path.length);
    const rep = sorted[0];
    const meta = rep.meta;

    built.push({
      stat_id: toStatId(statNm),
      stat_nm: statNm,
      agency: repairOrgName(meta?.MAINC_NM) ?? '국가데이터처',
      org_id: rep.org_id,
      category: topCategory(rep.category_path),
      tags: buildTags({ name: statNm, category: topCategory(rep.category_path), meta: (meta ?? {}) as Record<string, unknown> }),
      legal_basis: meta?.LAWFUL_BAS,
      purpose: meta?.PRP_CNT,
      target: meta?.STATS_TARGET,
      method: meta?.RESN_TXT,
      frequency: meta?.COLLECT_CYCLE,
      tables: ts.map(t => ({
        kosis_org_id: t.org_id,
        kosis_tbl_id: t.tbl_id,
        table_name: t.tbl_nm,
        category_path: t.category_path,
        is_representative: t === rep,
        kosis_url: t.link_url || `https://kosis.kr/statHtml/statHtml.do?orgId=${t.org_id}&tblId=${t.tbl_id}&conn_path=I3`,
        latest_period: t.meta?.END_PRD_DE,
      })),
      raw_meta: meta ?? null,
    });
  }

  built.sort((a, b) => a.stat_nm.localeCompare(b.stat_nm, 'ko'));

  writeFileSync(OUT_FILE, JSON.stringify(built, null, 2), 'utf-8');
  log.ok(`Built ${built.length} statistics -> ${OUT_FILE}`);

  const byCat = new Map<string, number>();
  for (const s of built) byCat.set(s.category, (byCat.get(s.category) ?? 0) + 1);
  log.info(`By category:`);
  [...byCat.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`   ${String(n).padStart(3)}  ${c}`));

  log.info(`Top 15 statistics by table count:`);
  [...built].sort((a, b) => b.tables.length - a.tables.length).slice(0, 15)
    .forEach(s => console.log(`   ${String(s.tables.length).padStart(3)}  ${s.stat_nm}  [${s.category}]`));
}

main();
