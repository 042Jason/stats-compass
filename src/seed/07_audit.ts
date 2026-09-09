/**
 * 데이터 상태 점검 — 재그룹핑 후 남은 이상치를 찾습니다.
 * 아무것도 수정하지 않습니다.
 *
 *   npx tsx src/seed/07_audit.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

/**
 * 웹사이트는 anon(publishable) 키로 읽습니다. 이 스크립트가 쓰는 service_role 키는
 * RLS 를 우회하므로, 서버에서 잘 보인다고 사이트에서도 보이는 것은 아닙니다.
 * 배포 전에 anon 키로도 실제로 읽히는지 반드시 확인해야 합니다.
 */
async function anonCheck(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  log.info('');
  log.info('=== anon 키로 본 건수 (웹사이트가 실제로 보는 것) ===');
  if (!url || !anon) {
    log.warn('  NEXT_PUBLIC_SUPABASE_ANON_KEY 가 .env 에 없어 건너뜁니다.');
    log.warn('  stats-compass-web/.env.local 의 값을 .env 에도 넣어주세요.');
    return;
  }
  const pub = createClient(url, anon, { auth: { persistSession: false } });
  for (const t of ['statistics', 'statistic_tables', 'curated_sets', 'curated_set_items', 'deep_dive_articles'] as const) {
    const { count, error } = await pub.from(t).select('id', { count: 'exact', head: true });
    if (error) log.err(`  ${t.padEnd(20)} 읽기 실패 — ${error.message}`);
    else if ((count ?? 0) === 0) log.warn(`  ${t.padEnd(20)} 0건 (RLS 정책 확인 필요할 수 있음)`);
    else log.ok(`  ${t.padEnd(20)} ${count}건`);
  }
  const { error: rpcErr } = await pub.rpc('search_all', { q: '인구', lim: 5 });
  if (rpcErr) log.warn(`  search_all()      아직 없음 — APPLY_ME.sql 미적용 (${rpcErr.message})`);
  else log.ok('  search_all()      동작');
}

async function countOf(table: string, apply?: (q: any) => any): Promise<number> {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  if (apply) q = apply(q);
  const { count, error } = await q;
  if (error) { log.warn(`${table}: ${error.message}`); return -1; }
  return count ?? 0;
}

async function main() {
  log.info('=== 건수 ===');
  log.info(`statistics 전체        ${await countOf('statistics')}`);
  log.info(`  active               ${await countOf('statistics', (q) => q.eq('status', 'active'))}`);
  log.info(`  merged               ${await countOf('statistics', (q) => q.eq('status', 'merged'))}`);
  log.info(`statistic_tables       ${await countOf('statistic_tables')}`);
  log.info(`  latest_period 있음    ${await countOf('statistic_tables', (q) => q.not('latest_period', 'is', null))}`);
  log.info(`curated_sets           ${await countOf('curated_sets')}`);
  log.info(`deep_dive_articles     ${await countOf('deep_dive_articles')}`);

  // active 인데 통계표가 하나도 없는 조사 = 목록에 빈 카드로 노출됨
  const { data: actives, error } = await supabase
    .from('statistics')
    .select('id, stat_id, name_ko, category, tags, status')
    .eq('status', 'active');
  if (error) throw error;

  // ⚠️ PostgREST 는 한 번에 최대 1,000행만 돌려줍니다. limit(5000) 을 줘도 소용없어서
  //    페이지 단위로 모두 읽어야 합니다. (이 페이징이 없으면 뒤쪽 통계표가 누락되어
  //    멀쩡한 조사가 '통계표 0개' 로 잘못 보고됩니다)
  const withTables = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error: tErr } = await supabase
      .from('statistic_tables')
      .select('statistic_id')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (tErr) throw tErr;
    if (!data || data.length === 0) break;
    for (const r of data) if (r.statistic_id) withTables.add(r.statistic_id as string);
    if (data.length < 1000) break;
  }
  log.info(`(통계표를 가진 조사 ${withTables.size}개 확인)`);

  const empty = (actives ?? []).filter((s) => !withTables.has(s.id as string));
  log.info('');
  log.info(`=== 통계표가 0개인 active 조사: ${empty.length}건 ===`);
  empty.forEach((s) => log.warn(`  ${s.name_ko}  (stat_id=${s.stat_id}, category=${s.category ?? '-'})`));

  const noTags = (actives ?? []).filter((s) => !Array.isArray(s.tags) || s.tags.length === 0);
  log.info('');
  log.info(`=== 태그가 없는 active 조사: ${noTags.length}건 ===`);
  noTags.slice(0, 20).forEach((s) => log.warn(`  ${s.name_ko}`));

  const nameCount = new Map<string, number>();
  for (const s2 of actives ?? []) nameCount.set(s2.name_ko as string, (nameCount.get(s2.name_ko as string) ?? 0) + 1);
  const dups = [...nameCount.entries()].filter(([, n]) => n > 1);
  log.info('');
  log.info(`=== 이름이 겹치는 active 조사: ${dups.length}건 ===`);
  dups.forEach(([n, c]) => {
    log.warn(`  ${n} (${c}개)`);
    (actives ?? []).filter((s2) => s2.name_ko === n).forEach((s2) =>
      log.warn(`      stat_id=${s2.stat_id}  통계표 ${withTables.has(s2.id as string) ? '있음' : '0개'}`));
  });

  await anonCheck();

  log.info('');
  log.info('=== active 조사 목록 ===');
  (actives ?? [])
    .sort((a, b) => String(a.category).localeCompare(String(b.category), 'ko'))
    .forEach((s) => log.info(`  [${String(s.category ?? '-').padEnd(10)}] ${s.name_ko}`));
}

main().catch((e) => { log.err('Fatal', e); process.exit(1); });
