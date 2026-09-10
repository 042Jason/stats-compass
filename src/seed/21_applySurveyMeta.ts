/**
 * 조사 메타 보강 — 관련부서(CSV) + 카드용 개요(LLM)
 *
 *   npx tsx src/seed/21_applySurveyMeta.ts              무엇이 바뀌는지 보기만
 *   npx tsx src/seed/21_applySurveyMeta.ts --apply      실제 반영
 *   npx tsx src/seed/21_applySurveyMeta.ts --only=부서   부서만 (LLM 호출 없음)
 *
 * 사전 준비: stats-compass-web/supabase/0017_summary.sql 실행
 *
 * ── 두 가지를 고칩니다
 *
 * ① 작성기관
 *    KOSIS 가 내려준 MAINC_NM 은 '통계청→국가데이터처' 일괄 치환 과정에서 손상돼
 *    "국가데이터처비스업동향과" 같은 값이 섞여 있었습니다. 지금까지는 부서 목록으로
 *    <추정 복원>했는데, 이제 공식 CSV 에 관련부서가 그대로 있으니 추정할 이유가 없습니다.
 *
 * ② 카드 개요
 *    작성목적 원문은 "ㅇ 인구규모, 분포 및 구조, 가구, 주택에 관한 특성을 파악하여…"
 *    처럼 행정 문서 말투라 카드 두 줄에 안 들어갑니다. 아예 없는 조사도 있습니다.
 *    LLM 이 한 문장으로 줄여 summary 칸에 넣습니다. purpose 원문은 건드리지 않습니다.
 *
 * ── 이름 맞추기
 *    CSV "초중고사교육비조사" vs DB "초중고 사교육비조사" 처럼 띄어쓰기가 다릅니다.
 *    공백·가운뎃점·괄호를 지운 뒤 맞춥니다. 그래도 안 맞으면 <건너뛰고 보고>합니다.
 *    비슷한 이름에 억지로 붙이면 엉뚱한 부서가 박힙니다.
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

const CACHE = 'data/seed/21_summaries.json';
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] ?? '';
const SKIP_LLM = ONLY === '부서';
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const ORG = '국가데이터처';

/* ── CSV 읽기 ──────────────────────────────────────────────────── */

/** 업로드된 CSV 를 찾습니다. 파일명이 길어 인자로 넘기기 번거롭습니다. */
function findCsv(): string {
  const explicit = process.argv.find((a) => a.startsWith('--csv='))?.split('=')[1];
  if (explicit) return explicit;
  for (const dir of ['data', '.', 'data/seed']) {
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).find((f) => f.endsWith('.csv') && f.includes('관련부서'));
    if (hit) return `${dir}/${hit}`;
  }
  throw new Error('관련부서 CSV 를 찾지 못했습니다. --csv=경로 로 지정하세요.');
}

/**
 * 이 CSV 는 cp949(euc-kr)입니다. UTF-8 로 읽으면 글자가 깨집니다.
 * 두 인코딩으로 디코딩해 보고 대체문자(U+FFFD)가 적은 쪽을 씁니다.
 */
function decode(buf: Buffer): string {
  const tries = ['euc-kr', 'utf-8'];
  let best = '';
  let bestBad = Infinity;
  for (const enc of tries) {
    try {
      const t = new TextDecoder(enc).decode(buf);
      const bad = (t.match(/�/g) ?? []).length;
      if (bad < bestBad) {
        bestBad = bad;
        best = t;
      }
    } catch {
      /* 지원하지 않는 인코딩이면 건너뜁니다 */
    }
  }
  if (bestBad > 0) log.warn(`CSV 에 깨진 글자 ${bestBad}자가 있습니다`);
  return best;
}

/** 따옴표 안의 쉼표·줄바꿈을 지키는 최소 CSV 파서 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** 조사명 비교용 정규화 — 공백·가운뎃점·괄호·기호를 지웁니다 */
const norm = (s: string): string =>
  s.replace(/[\s()（）［\][\]·ㆍ・,，.／/–—-]/g, '').trim();

/* ── LLM ──────────────────────────────────────────────────────── */

const SYSTEM = `당신은 국가통계 카탈로그의 편집자입니다. 조사의 <작성목적> 원문을 목록 카드에 들어갈 한 문장으로 줄입니다.

규칙:
- 한 문장, 45~70자. 반드시 "~합니다" 또는 명사형으로 끝냅니다.
- 원문에 없는 사실을 넣지 마세요. 수치·연도를 지어내면 안 됩니다.
- "ㅇ", "등에 활용", "기초자료로 활용" 같은 행정 문서 상투어는 덜어냅니다.
- 무엇을 조사하는지가 첫머리에 오게 씁니다. 목적은 뒤에 붙입니다.
- 조사명을 문장에 반복하지 마세요. 카드에 제목이 이미 있습니다.

예)
원문: ㅇ 인구규모, 분포 및 구조, 가구, 주택에 관한 특성을 파악하여 각종 정책입안의 기초자료로 활용 ㅇ 각종 표본조사의 표본틀로 활용
출력: 인구 규모와 분포, 가구·주택 특성을 파악해 정책 수립과 표본 설계의 바탕이 됩니다.

출력은 문장 하나만. 따옴표나 접두어를 붙이지 마세요.`;

async function summarize(name: string, purpose: string, freq: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 가 없습니다');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `조사명: ${name}\n작성주기: ${freq || '-'}\n작성목적 원문:\n${purpose}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`LLM ${res.status} ${detail}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const out = json.choices?.[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
  return out || null;
}

/* ── 메인 ─────────────────────────────────────────────────────── */

interface Stat { id: string; stat_id: string; name_ko: string; agency: string | null; summary: string | null }

async function main() {
  const csvPath = findCsv();
  const rows = parseCsv(decode(readFileSync(csvPath)));
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iDept = idx('관련부서');
  const iName = idx('통계명');
  const iPurpose = idx('작성목적');
  const iFreq = idx('작성주기');
  if (iDept < 0 || iName < 0) throw new Error(`CSV 머리글이 예상과 다릅니다: ${header.join(', ')}`);

  const csv = rows.slice(1).map((r) => ({
    dept: (r[iDept] ?? '').trim(),
    name: (r[iName] ?? '').trim(),
    purpose: (r[iPurpose] ?? '').trim(),
    freq: (r[iFreq] ?? '').trim(),
  })).filter((r) => r.name);
  log.info(`${csvPath} — ${csv.length}건`);

  const { data, error } = await supabase
    .from('statistics')
    .select('id, stat_id, name_ko, agency, summary')
    .or('status.is.null,status.neq.merged')
    .order('id');
  if (error) throw error;
  const stats = (data ?? []) as Stat[];
  log.info(`DB 조사 ${stats.length}건`);

  const byNorm = new Map<string, Stat[]>();
  for (const s of stats) {
    const k = norm(s.name_ko);
    byNorm.set(k, [...(byNorm.get(k) ?? []), s]);
  }

  const cache: Record<string, string> = existsSync(CACHE)
    ? (JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, string>)
    : {};

  const updates: Array<{ id: string; name: string; agency?: string; summary?: string; what: string[] }> = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];

  for (const row of csv) {
    const hits = byNorm.get(norm(row.name)) ?? [];
    if (hits.length === 0) { unmatched.push(row.name); continue; }
    if (hits.length > 1) { ambiguous.push(`${row.name} (${hits.length}건)`); continue; }
    const s = hits[0];

    const what: string[] = [];
    const patch: { agency?: string; summary?: string } = {};

    const agency = row.dept.startsWith(ORG) ? row.dept : `${ORG} ${row.dept}`;
    if (row.dept && agency !== (s.agency ?? '')) {
      patch.agency = agency;
      what.push(`부서 "${s.agency ?? '-'}" → "${agency}"`);
    }

    if (!SKIP_LLM && row.purpose) {
      let text = cache[s.stat_id];
      if (!text) {
        try {
          text = (await summarize(row.name, row.purpose, row.freq)) ?? '';
        } catch (e) {
          log.warn(`  개요 실패 ${row.name}: ${e instanceof Error ? e.message : String(e)}`);
          text = '';
        }
        if (text) {
          cache[s.stat_id] = text;
          writeFileSync(CACHE, JSON.stringify(cache, null, 2), 'utf8');
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (text && text !== (s.summary ?? '')) {
        patch.summary = text;
        what.push('개요');
      }
    }

    if (what.length > 0) updates.push({ id: s.id, name: s.name_ko, ...patch, what });
  }

  log.info('');
  for (const u of updates.slice(0, 40)) {
    log.info(`  ${u.name} — ${u.what.join(', ')}`);
    if (u.summary) log.info(`      ${u.summary}`);
  }
  if (updates.length > 40) log.info(`  … 외 ${updates.length - 40}건`);

  log.info('');
  log.info(`수정 대상 ${updates.length}건`);
  if (unmatched.length > 0) {
    log.warn(`DB 에서 못 찾은 CSV 조사 ${unmatched.length}건 — 건너뜁니다`);
    for (const n of unmatched) log.warn(`  ${n}`);
  }
  if (ambiguous.length > 0) {
    log.warn(`이름이 겹쳐 건너뛴 ${ambiguous.length}건: ${ambiguous.join(' / ')}`);
  }
  const csvNames = new Set(csv.map((r) => norm(r.name)));
  const noCsv = stats.filter((s) => !csvNames.has(norm(s.name_ko)));
  if (noCsv.length > 0) {
    log.warn(`CSV 에 없는 DB 조사 ${noCsv.length}건 — 부서·개요가 그대로입니다`);
    for (const s of noCsv) log.warn(`  ${s.name_ko}`);
  }

  if (!APPLY) {
    log.warn('--apply 를 붙이지 않아 아무것도 바꾸지 않았습니다.');
    return;
  }

  for (const u of updates) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (u.agency) patch.agency = u.agency;
    if (u.summary) patch.summary = u.summary;
    const { error: e } = await supabase.from('statistics').update(patch).eq('id', u.id);
    if (e) throw e;
  }
  log.ok(`반영 완료 ${updates.length}건 · 개요 캐시 ${CACHE}`);
  log.info('부서명이 바뀌었으니 온톨로지도 다시 만드세요 → npx tsx src/seed/12_buildOntology.ts');
}

main().catch((e) => {
  log.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
