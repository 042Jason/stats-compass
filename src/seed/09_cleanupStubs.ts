/**
 * 재그룹핑 후 남은 껍데기 조사 정리
 *
 * 06_regroup 은 '통계표를 가지고 있던' 옛 조사만 merged 로 표시합니다.
 * 통계표가 원래 0개였던 옛 수기 행(예: stat_id=101_DA7 경제활동인구조사)은
 * 손대지 않으므로 목록에 빈 카드로 남습니다. 그것만 골라 정리합니다.
 *
 * 판정 기준 (둘 다 만족해야 함)
 *   - 통계표가 0개
 *   - stat_id 가 02_meta.json 으로 계산한 정식 조사 52개에 없음
 * 삭제하지 않고 status='merged' 로만 바꿉니다.
 *
 *   npx tsx src/seed/09_cleanupStubs.ts            # 목록만 출력
 *   npx tsx src/seed/09_cleanupStubs.ts --apply    # 실제 반영
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';
import { surveyName, toStatId } from '../utils/survey.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const meta = JSON.parse(readFileSync('data/seed/02_meta.json', 'utf-8')) as Array<{
    category_path?: string;
    meta?: Record<string, unknown> | null;
  }>;
  const canonical = new Set(meta.map((t) => toStatId(surveyName(t))));
  log.info(`정식 조사 ${canonical.size}개 (02_meta.json 기준)`);

  const withTables = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('statistic_tables')
      .select('statistic_id')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) if (r.statistic_id) withTables.add(r.statistic_id as string);
    if (data.length < 1000) break;
  }

  const { data: actives, error } = await supabase
    .from('statistics')
    .select('id, stat_id, name_ko, category')
    .eq('status', 'active');
  if (error) throw error;

  const stubs = (actives ?? []).filter(
    (s) => !withTables.has(s.id as string) && !canonical.has(s.stat_id as string),
  );

  log.info(`active ${actives?.length ?? 0}건 중 껍데기 ${stubs.length}건`);
  stubs.forEach((s) => log.warn(`  ${s.name_ko}  (stat_id=${s.stat_id}, category=${s.category ?? '-'})`));

  const keep = (actives ?? []).length - stubs.length;
  log.info(`정리하면 active ${keep}건이 됩니다.`);

  if (!APPLY) {
    log.warn('--apply 를 붙이면 실제로 status=merged 로 바꿉니다. 지금은 아무것도 수정하지 않았습니다.');
    return;
  }
  for (const s of stubs) {
    const { error: uErr } = await supabase.from('statistics').update({ status: 'merged' }).eq('id', s.id);
    if (uErr) log.err(`${s.name_ko} 실패`, uErr.message);
  }
  const { count } = await supabase
    .from('statistics')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  log.ok(`완료 — active 조사 ${count}건`);
}

main().catch((e) => { log.err('Fatal', e); process.exit(1); });
