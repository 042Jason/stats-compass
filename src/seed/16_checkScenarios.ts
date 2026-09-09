/**
 * 시연 시나리오 검증
 *
 * 시연에서 실제로 보여줄 두 질의를 끝까지 태워 보고,
 *   ① 슬롯이 제대로 풀리는지 (resolve_age / resolve_region)
 *   ② 어떤 별칭·설명자료 청크로 걸렸는지 (seeds)
 *   ③ 기대한 조사·통계표가 실제로 나오는지 (Recall)
 * 를 한 번에 확인합니다. 발표에서 쓸 정확도 근거이기도 합니다.
 *
 * 사전 준비: 0005~0007 실행, 12_buildOntology, 15_embed 완료, .env 에 OPENAI_API_KEY
 *
 *   npx tsx src/seed/16_checkScenarios.ts
 *   npx tsx src/seed/16_checkScenarios.ts --verbose
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

const FILE = 'data/seed/16_scenarios.json';
const VERBOSE = process.argv.includes('--verbose');
const MODEL = 'text-embedding-3-small';

interface Scenario {
  key: string;
  title: string;
  query: string;
  slots: { age: number | null; sexText: string | null; regionText: string | null };
  expectStages: string[];
  expectSurveys: string[];
  expectTables: string[];
  expectTableOwner: Record<string, string>;
  expectCautionWith: string[];
}

async function embed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, input: text, dimensions: 1536 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return j.data[0].embedding;
}

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('.env 에 OPENAI_API_KEY 가 필요합니다');

  const { scenarios }: { scenarios: Scenario[] } = JSON.parse(readFileSync(FILE, 'utf-8'));
  let totalHit = 0;
  let totalWant = 0;

  for (const sc of scenarios) {
    log.info('');
    log.info(`━━ ${sc.title}`);
    log.info(`   "${sc.query}"`);

    /* ① 슬롯 해석 */
    if (sc.slots.age != null) {
      const { data, error } = await supabase.rpc('resolve_age', { p_age: sc.slots.age });
      if (error) throw error;
      const d = data as { bands?: Array<{ label: string }>; stages?: Array<{ key: string; label: string }> };
      const gotStages = (d.stages ?? []).map((s) => s.key);
      const missStage = sc.expectStages.filter((s) => !gotStages.includes(s));
      log.info(`   나이 ${sc.slots.age} → ${(d.bands ?? []).map((b) => b.label).join(', ')}`);
      log.info(
        `   생애단계 → ${(d.stages ?? []).map((s) => s.label).join(', ')}` +
          (missStage.length ? `   ⚠ 기대 누락: ${missStage.join(', ')}` : '  ✓'),
      );
    }
    if (sc.slots.regionText) {
      const { data, error } = await supabase.rpc('resolve_region', { p_text: sc.slots.regionText });
      if (error) throw error;
      const rs = (data ?? []) as Array<{ code: string; label: string }>;
      log.info(`   지역 "${sc.slots.regionText}" → ${rs.map((r) => `${r.label}(${r.code})`).join(', ') || '없음'}`);
    }

    /* ② 하이브리드 GraphRAG */
    /* 기대 통계표가 애초에 노드로 존재하는지 먼저 봅니다.
       조사당 80개 상한에 잘렸으면 검색을 아무리 고쳐도 나올 수 없습니다. */
    const wantKeys = sc.expectTables.map((t) => `101-${t}`);
    const { data: nodeRows } = await supabase
      .from('ontology_entities')
      .select('key')
      .eq('class_id', 'StatisticalTable')
      .in('key', wantKeys)
      .order('id');
    const haveKeys = new Set((nodeRows ?? []).map((r) => String((r as { key: string }).key)));
    const notNode = sc.expectTables.filter((t) => !haveKeys.has(`101-${t}`));
    if (notNode.length > 0) {
      log.warn(`   ⚠ 노드에 아예 없는 기대 통계표: ${notNode.join(', ')} — 12_buildOntology 를 다시 돌려야 합니다`);
    }

    const vec = await embed(sc.query, apiKey);
    const { data, error } = await supabase.rpc('graphrag_search', {
      p_embedding: JSON.stringify(vec),
      p_query: sc.query,
      p_stages: null,
      p_seed_k: 16,
      p_limit: 8,
      p_want_region: sc.slots.regionText != null,
    });
    // Supabase 오류는 Error 인스턴스가 아니라 평범한 객체입니다.
    // 그대로 throw 하면 String() 이 [object Object] 를 내놓아 원인을 못 봅니다.
    if (error) {
      throw new Error(
        `graphrag_search 실패: ${error.message}\n` +
          `  code=${error.code ?? '-'}  details=${error.details ?? '-'}  hint=${error.hint ?? '-'}`,
      );
    }
    const r = data as {
      seeds?: Array<{ label: string; class: string; kind: string; field: string | null; sim: number; quote: string | null }>;
      surveys?: Array<{ label: string; score: number }>;
      tables?: Array<{ label: string; tblId: string | null; survey: string | null }>;
      concepts?: Array<{ label: string }>;
      cautions?: Array<{ a: string; b: string }>;
    };

    const seeds = r.seeds ?? [];
    log.info(`   진입 노드 ${seeds.length}개`);
    for (const s of seeds.slice(0, 6)) {
      const via = s.kind === 'alias' ? '별칭' : s.kind === 'meta' ? `설명자료·${s.field ?? ''}` : '본문';
      log.info(`      ${s.sim.toFixed(2)} [${via}] ${s.class} · ${s.label}`);
      if (VERBOSE && s.quote) log.info(`           "${s.quote.slice(0, 80)}"`);
    }

    /* ③ 기대 대비 판정 */
    const gotSurveys = (r.surveys ?? []).map((s) => s.label);
    const hitS = sc.expectSurveys.filter((x) => gotSurveys.includes(x));
    const missS = sc.expectSurveys.filter((x) => !gotSurveys.includes(x));
    log.info(`   조사 ${gotSurveys.length}건: ${gotSurveys.join(', ')}`);
    log.info(
      `   기대 조사 ${hitS.length}/${sc.expectSurveys.length} (${pct(hitS.length, sc.expectSurveys.length)}%)` +
        (missS.length ? `  ⚠ 누락: ${missS.join(', ')}` : '  ✓'),
    );

    const gotTables = (r.tables ?? []).map((t) => t.tblId ?? '');
    const gotTableSurveys = new Set((r.tables ?? []).map((t) => t.survey ?? ''));
    log.info(`   통계표 ${gotTables.length}건: ${gotTables.slice(0, 8).join(', ')}`);

    // 엄격: 정확히 그 tblId
    const hitExact = sc.expectTables.filter((x) => gotTables.includes(x));
    // 느슨: 기대 통계표가 속한 조사의 표가 하나라도 나왔는가 (이쪽을 점수로 씁니다)
    const hitT = sc.expectTables.filter((x) => gotTableSurveys.has(sc.expectTableOwner[x] ?? '__'));
    const missT = sc.expectTables.filter((x) => !gotTableSurveys.has(sc.expectTableOwner[x] ?? '__'));
    log.info(
      `   기대 통계표(조사 단위) ${hitT.length}/${sc.expectTables.length} (${pct(hitT.length, sc.expectTables.length)}%)` +
        (missT.length ? `  ⚠ 누락: ${missT.map((x) => `${x}(${sc.expectTableOwner[x]})`).join(', ')}` : '  ✓'),
    );
    log.info(`   (참고) 정확한 tblId 일치 ${hitExact.length}/${sc.expectTables.length}`);

    const cautions = r.cautions ?? [];
    const cautionNames = new Set(cautions.flatMap((c) => [c.a, c.b]));
    const hitC = sc.expectCautionWith.filter((x) => cautionNames.has(x));
    log.info(
      `   경고 ${cautions.length}건` +
        (cautions.length ? `: ${cautions.map((c) => `${c.a}↔${c.b}`).join(' / ')}` : '') +
        `   기대 대상 ${hitC.length}/${sc.expectCautionWith.length}`,
    );
    if ((r.concepts ?? []).length > 0) {
      log.info(`   통계용어: ${(r.concepts ?? []).map((c) => c.label).slice(0, 8).join(', ')}`);
    }

    totalHit += hitS.length + hitT.length;
    totalWant += sc.expectSurveys.length + sc.expectTables.length;
  }

  log.info('');
  log.ok(`종합 적중 ${totalHit}/${totalWant} (${pct(totalHit, totalWant)}%)`);
  if (pct(totalHit, totalWant) < 70) {
    log.warn('70% 미만입니다. 별칭 사전이나 지표 매핑을 손봐야 합니다.');
  }
}

main().catch((e) => {
  log.err(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e, null, 2));
  process.exit(1);
});
