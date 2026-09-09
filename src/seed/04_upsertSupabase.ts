/**
 * Supabase 배치 upsert (재실행 안전)
 */
import { readFileSync } from 'node:fs';
import { supabase } from '../clients/supabase.js';
import type { BuiltStatistic } from '../types.js';
import { log } from '../utils/logger.js';

const IN_FILE = 'data/seed/03_statistics.json';
const BATCH = 100;

async function main() {
  const stats: BuiltStatistic[] = JSON.parse(readFileSync(IN_FILE, 'utf-8'));
  log.info(`Upserting ${stats.length} statistics`);

  const statRows = stats.map(s => ({
    stat_id: s.stat_id, name_ko: s.stat_nm, agency: s.agency, org_id: s.org_id,
    category: s.category, legal_basis: s.legal_basis, purpose: s.purpose,
    target: s.target, method: s.method, frequency: s.frequency,
    raw_meta: s.raw_meta, status: 'active',
  }));

  for (let i = 0; i < statRows.length; i += BATCH) {
    const batch = statRows.slice(i, i + BATCH);
    const { error } = await supabase.from('statistics').upsert(batch, { onConflict: 'stat_id' });
    if (error) { log.err(`stats batch ${i} failed`, error); throw error; }
    log.info(`Statistics: ${Math.min(i + BATCH, statRows.length)}/${statRows.length}`);
  }
  log.ok(`All statistics upserted`);

  const { data: statMap, error: mapErr } = await supabase.from('statistics').select('id, stat_id');
  if (mapErr) throw mapErr;
  const idByStatId = new Map(statMap!.map(r => [r.stat_id, r.id]));

  const tableRows: any[] = [];
  for (const s of stats) {
    const uuid = idByStatId.get(s.stat_id);
    if (!uuid) { log.warn(`missing uuid for ${s.stat_id}`); continue; }
    s.tables.forEach((t, idx) => tableRows.push({
      statistic_id: uuid, kosis_org_id: t.kosis_org_id, kosis_tbl_id: t.kosis_tbl_id,
      table_name: t.table_name, category_path: t.category_path,
      is_representative: t.is_representative, display_order: idx,
      kosis_url: t.kosis_url, latest_period: t.latest_period,
    }));
  }

  for (let i = 0; i < tableRows.length; i += BATCH) {
    const batch = tableRows.slice(i, i + BATCH);
    const { error } = await supabase.from('statistic_tables').upsert(batch, { onConflict: 'kosis_org_id,kosis_tbl_id' });
    if (error) { log.err(`tables batch ${i} failed`, error); throw error; }
    log.info(`Tables: ${Math.min(i + BATCH, tableRows.length)}/${tableRows.length}`);
  }

  const { count: sc } = await supabase.from('statistics').select('*', { count: 'exact', head: true });
  const { count: tc } = await supabase.from('statistic_tables').select('*', { count: 'exact', head: true });
  log.ok(`Final: ${sc} statistics, ${tc} tables in Supabase`);
}

main().catch(e => { log.err('Fatal', e); process.exit(1); });
