/**
 * AI 정제 콘텐츠를 Supabase 에 반영
 *
 * data/seed/11_ai_output.json 을 읽어 statistics.ai_content 와 description 을 채웁니다.
 * 원문(raw_meta)은 건드리지 않습니다 — 정제본은 별도 칸에만 들어갑니다.
 *
 * 사전 준비: supabase/0003_ai_content.sql 을 SQL Editor 에서 한 번 실행
 *
 *   npx tsx src/seed/11_applyAiContent.ts --dry-run
 *   npx tsx src/seed/11_applyAiContent.ts
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

const IN_FILE = 'data/seed/11_ai_output.json';
const DRY = process.argv.includes('--dry-run');

interface AiEntry {
  stat_id: string;
  name: string;
  /** 목록·검색용 한 줄 */
  summary?: string;
  /** 상세 상단 2~3문장 */
  overview: string;
  terms?: Array<{ term: string; plain: string }>;
  cautions?: string[];
  sources?: Array<{ title: string; url: string }>;
}

async function main() {
  const entries: AiEntry[] = JSON.parse(readFileSync(IN_FILE, 'utf-8'));
  log.info(`정제 콘텐츠 ${entries.length}건 로드`);

  const { data: stats, error } = await supabase
    .from('statistics')
    .select('id, stat_id, name_ko')
    .eq('status', 'active');
  if (error) throw error;

  const byStatId = new Map((stats ?? []).map((s) => [s.stat_id as string, s.id as string]));
  const byName = new Map((stats ?? []).map((s) => [s.name_ko as string, s.id as string]));
  const loose = (v: string) => v.replace(/\s+/g, '').replace(/\(.*?\)/g, '').toLowerCase();
  const byLoose = new Map((stats ?? []).map((s) => [loose(s.name_ko as string), s.id as string]));

  const resolve = (e: AiEntry) =>
    byStatId.get(e.stat_id) ?? byName.get(e.name) ?? byLoose.get(loose(e.name)) ?? null;

  const missing = entries.filter((e) => !resolve(e));
  if (missing.length) {
    log.warn(`DB 에서 못 찾은 조사 ${missing.length}건: ${missing.map((m) => m.name).join(', ')}`);
  }

  if (DRY) {
    log.info(`연결 가능 ${entries.length - missing.length}/${entries.length}건`);
    entries.slice(0, 3).forEach((e) =>
      log.info(`  ${e.name}: ${e.overview.slice(0, 70)}…  (용어 ${e.terms?.length ?? 0}, 유의 ${e.cautions?.length ?? 0})`),
    );
    log.warn('--dry-run 이므로 DB 를 수정하지 않았습니다.');
    return;
  }

  const now = new Date().toISOString();
  let done = 0;
  for (const e of entries) {
    const id = resolve(e);
    if (!id) continue;
    const { error: uErr } = await supabase
      .from('statistics')
      .update({
        description: e.overview,
        ai_content: {
          summary: e.summary ?? null,
          overview: e.overview,
          terms: e.terms ?? [],
          cautions: e.cautions ?? [],
          sources: e.sources ?? [],
          generated_at: now,
        },
      })
      .eq('id', id);
    if (uErr) log.err(`${e.name} 실패`, uErr.message);
    else done++;
    if (done % 20 === 0) log.info(`반영 ${done}/${entries.length}`);
  }

  const { count } = await supabase
    .from('statistics')
    .select('id', { count: 'exact', head: true })
    .not('ai_content', 'is', null);
  log.ok(`완료 — ${done}건 반영, ai_content 보유 ${count}건`);
}

main().catch((e) => { log.err('Fatal', e); process.exit(1); });
