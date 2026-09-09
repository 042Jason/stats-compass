/**
 * 온톨로지 임베딩 생성 (OpenAI text-embedding-3-small, 1536차원)
 *
 * 노드 하나가 여러 벡터를 가집니다 (0006_hybrid.sql 기준, 1:N).
 *   main  — 라벨 + 정제 개요
 *   alias — 별칭 하나당 한 행. "빚" 같은 짧은 말이 독립적으로 걸려야 하기 때문입니다.
 *   meta  — KOSIS 원문 설명자료를 항목별로 자른 청크 (조사목적·조사항목·주요용어 …)
 *
 * 사전 준비: 0006_hybrid.sql 실행, .env 에 OPENAI_API_KEY
 *
 *   npx tsx src/seed/15_embed.ts --dry-run
 *   npx tsx src/seed/15_embed.ts
 *   npx tsx src/seed/15_embed.ts --force
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

const MODEL = 'text-embedding-3-small';
const DIM = 1536;
const BATCH = 96;
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

/** 검색 진입점이 될 수 있는 클래스만 임베딩합니다. */
const TARGET_CLASSES = [
  'Survey',
  'Concept',
  'Indicator',
  'ResearchQuestion',
  'Keyword',
  'Theme',
  'LifeStage',
  'StatisticalTable',
  'Region',
  'AgeBand',
  'MaritalStatus',
];

/** 설명자료에서 뽑을 항목. [원문 키들, 표시할 이름] */
const META_FIELDS: Array<[string[], string]> = [
  [['PRP_CNT', 'writingPurps'], '조사목적'],
  [['STATS_TARGET', 'examinObjrange'], '조사대상'],
  [['examinObjArea'], '조사대상지역'],
  [['RESN_TXT', 'dataCollectMth'], '조사방법'],
  [['josaUnit'], '조사단위'],
  [['josaItm'], '조사항목'],
  [['mainTermExpl'], '주요용어'],
  [['dataUserNote'], '이용시 유의사항'],
  [['examinHistory'], '조사연혁'],
];

const CHUNK = 700;

interface Ent {
  id: string;
  class_id: string;
  label: string;
  alt_labels: string[] | null;
  description: string | null;
  props: Record<string, unknown> | null;
  statistic_id: string | null;
}

interface Row {
  entity_id: string;
  kind: 'main' | 'alias' | 'meta';
  field: string | null;
  content: string;
  content_hash: string;
}

const sha = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 32);

/** PostgREST 는 1,000행에서 자르므로 range 로 나눠 받습니다. */
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** KOSIS 메타는 HTML 엔티티가 이중 이스케이프되어 옵니다. */
function clean(v: unknown): string {
  let s = String(v ?? '');
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
      .replace(/&times;/g, '×').replace(/&sim;/g, '~');
  }
  s = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return ['-', '없음', '해당없음', '해당 없음', '미해당'].includes(s) ? '' : s;
}

/** 문장 경계를 살려 자릅니다. */
function chunks(text: string, size = CHUNK): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  let buf = '';
  for (const part of text.split(/(?<=[.。!?]|다\.)\s+/)) {
    if ((buf + part).length > size && buf) {
      out.push(buf.trim());
      buf = '';
    }
    buf += part + ' ';
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((c) => c.length >= 20);
}

/** 노드 본문. 클래스마다 담는 내용이 다릅니다. */
function mainContent(e: Ent, parentSurvey: string | null): string {
  const p = e.props ?? {};
  const lines: string[] = [];
  switch (e.class_id) {
    case 'Survey':
      lines.push(`통계조사: ${e.label}`);
      if (e.description) lines.push(e.description);
      if (p.regionLevel) lines.push(`지역 단위: ${String(p.regionLevel)}`);
      break;
    case 'Indicator':
      lines.push(`통계지표: ${e.label}${p.unit ? ` (단위 ${String(p.unit)})` : ''}`);
      if (e.description) lines.push(e.description);
      if (p.note) lines.push(String(p.note));
      break;
    case 'ResearchQuestion':
      lines.push(`연구질문: ${e.label}`);
      if (e.description) lines.push(e.description);
      if (p.caution) lines.push(String(p.caution));
      break;
    case 'StatisticalTable':
      lines.push(`통계표: ${e.label}`);
      if (parentSurvey) lines.push(`출처 조사: ${parentSurvey}`);
      break;
    case 'Concept':
      lines.push(`통계용어: ${e.label}`);
      if (e.description) lines.push(e.description);
      break;
    case 'LifeStage':
      lines.push(`생애단계: ${e.label}`);
      if (e.description) lines.push(e.description);
      break;
    case 'Region':
      lines.push(`지역: ${e.label}`);
      break;
    case 'AgeBand':
      lines.push(`연령대: ${e.label}`);
      break;
    case 'MaritalStatus':
      lines.push(`혼인상태: ${e.label}`);
      break;
    default:
      lines.push(`${e.class_id}: ${e.label}`);
      if (e.description) lines.push(e.description);
  }
  return lines.join('\n').slice(0, 4000);
}

async function embed(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIM }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !DRY) throw new Error('.env 에 OPENAI_API_KEY 가 필요합니다');

  const ents = await pageAll<Ent>((from, to) =>
    supabase
      .from('ontology_entities')
      .select('id, class_id, label, alt_labels, description, props, statistic_id')
      .in('class_id', TARGET_CLASSES)
      // ORDER BY 없이 range 를 쓰면 페이지 간 행이 중복·누락됩니다.
      .order('id')
      .range(from, to),
  );
  log.info(`노드 ${ents.length}건`);

  // 통계표는 어느 조사 것인지 함께 넣어야 의미가 삽니다.
  const rels = await pageAll<{ source_id: string; target_id: string }>((from, to) =>
    supabase
      .from('ontology_relations')
      .select('source_id, target_id')
      .eq('property_id', 'hasDistribution')
      .order('id')
      .range(from, to),
  );
  const labelById = new Map(ents.map((e) => [e.id, e.label]));
  const parentOf = new Map<string, string>();
  for (const r of rels) {
    const l = labelById.get(r.source_id);
    if (l) parentOf.set(r.target_id, l);
  }

  // 조사 노드의 원문 설명자료
  const statIds = ents.map((e) => e.statistic_id).filter((x): x is string => !!x);
  const metaByStat = new Map<string, Record<string, unknown>>();
  if (statIds.length > 0) {
    const stats = await pageAll<{ id: string; raw_meta: Record<string, unknown> | null }>((from, to) =>
      supabase.from('statistics').select('id, raw_meta').in('id', statIds).order('id').range(from, to),
    );
    for (const s of stats) metaByStat.set(s.id, s.raw_meta ?? {});
  }

  /* ── 행 만들기 ─────────────────────────────────────────────── */
  const rows: Row[] = [];
  const seen = new Set<string>();
  const push = (entity_id: string, kind: Row['kind'], field: string | null, content: string) => {
    const c = content.trim();
    if (c.length < 2) return;
    const hash = sha(`${MODEL}|${c}`);
    const k = `${entity_id}|${hash}`;
    if (seen.has(k)) return;
    seen.add(k);
    rows.push({ entity_id, kind, field, content: c, content_hash: hash });
  };

  for (const e of ents) {
    push(e.id, 'main', null, mainContent(e, parentOf.get(e.id) ?? null));

    // 별칭은 하나씩 독립 벡터로
    for (const a of e.alt_labels ?? []) {
      const t = String(a).trim();
      if (t && t !== e.label) push(e.id, 'alias', null, t);
    }

    // 설명자료 청크 (조사 노드만)
    if (e.class_id === 'Survey' && e.statistic_id) {
      const m = metaByStat.get(e.statistic_id) ?? {};
      for (const [keys, name] of META_FIELDS) {
        const raw = clean(keys.map((k) => m[k]).find((v) => v != null && String(v).trim() !== ''));
        if (!raw) continue;
        for (const c of chunks(raw)) push(e.id, 'meta', name, `${e.label} · ${name}\n${c}`);
      }
    }
  }

  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
  log.info(`임베딩 대상 ${rows.length}행`);
  for (const [k, v] of [...byKind].sort((a, b) => b[1] - a[1])) log.info(`   ${k}: ${v}`);

  /* ── 이미 있는 것 건너뛰기 ─────────────────────────────────── */
  const existing = await pageAll<{ entity_id: string; content_hash: string }>((from, to) =>
    supabase.from('ontology_embeddings').select('entity_id, content_hash').order('id').range(from, to),
  );
  const have = new Set(existing.map((e) => `${e.entity_id}|${e.content_hash}`));
  const todo = FORCE ? rows : rows.filter((r) => !have.has(`${r.entity_id}|${r.content_hash}`));
  log.info(`새로 만들 것 ${todo.length}행 (기존 ${existing.length}행)`);

  if (DRY) {
    log.warn('--dry-run 이므로 API 호출과 저장을 하지 않았습니다.');
    for (const kind of ['main', 'alias', 'meta'] as const) {
      const s = todo.find((r) => r.kind === kind);
      if (s) log.info(`예시 [${kind}${s.field ? `·${s.field}` : ''}] ${s.content.slice(0, 90)}`);
    }
    return;
  }
  if (todo.length === 0) {
    log.ok('바뀐 내용이 없습니다.');
    return;
  }

  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const vectors = await embed(chunk.map((c) => c.content), apiKey!);
    const payload = chunk.map((c, j) => ({
      entity_id: c.entity_id,
      kind: c.kind,
      field: c.field,
      content: c.content,
      content_hash: c.content_hash,
      model: MODEL,
      // pgvector 는 '[1,2,3]' 문자열을 받습니다.
      embedding: JSON.stringify(vectors[j]),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('ontology_embeddings')
      // 0006 의 unique 제약은 (entity_id, content_hash) 입니다.
      .upsert(payload, { onConflict: 'entity_id,content_hash' });
    if (error) throw new Error(`${error.message} ${JSON.stringify(error)}`);
    log.info(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }

  log.ok(`완료 — 임베딩 ${todo.length}행`);
}

main().catch((e) => {
  const msg =
    e instanceof Error ? (e.stack ?? e.message) : typeof e === 'object' ? JSON.stringify(e) : String(e);
  log.err(msg);
  process.exit(1);
});
