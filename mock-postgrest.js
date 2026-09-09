/* 실제 시드 데이터(03_statistics.json)를 PostgREST 형태로 서빙하는 검증용 목 서버 */
const http = require('http');
const fs = require('fs');
const { randomUUID } = require('crypto');

const SEED = '/sessions/vibrant-nifty-wozniak/mnt/보수교육_프로젝트/data/seed/03_statistics.json';
const built = JSON.parse(fs.readFileSync(SEED, 'utf8'));

const statistics = [];
const statistic_tables = [];
// 재그룹핑 후 상태 재현: statsNm 기준으로 묶고, 옛 행은 merged 로 남김
const SUFFIX = /(조사|통계|총조사|센서스|계정|지수|생명표|추계|현황|동향)$/;
function surveyName(catPath, meta) {
  const s = String((meta && (meta.statsNm || meta.STAT_NM)) || '').trim();
  if (s) return s;
  const parts = String(catPath || '').split(' > ').map(x => x.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) if (SUFFIX.test(parts[i])) return parts[i];
  return parts[parts.length - 1] || '(미분류)';
}
const groups = new Map();
for (const s of built) {
  for (const t of s.tables) {
    const name = surveyName(t.category_path, s.raw_meta);
    if (!groups.has(name)) groups.set(name, { meta: s.raw_meta, cat: String(t.category_path||'').split(' > ')[0], tables: [] });
    groups.get(name).tables.push(t);
  }
}
let gi = 0;
for (const [name, g] of groups) {
  const id = randomUUID();
  statistics.push({
    id, stat_id: name.replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase(), name_ko: name,
    agency: '국가데이터처 고용통계과', org_id: '101', category: g.cat,
    legal_basis: null, purpose: (g.meta && g.meta.PRP_CNT) || null,
    target: (g.meta && g.meta.STATS_TARGET) || null, method: null,
    frequency: (g.meta && g.meta.COLLECT_CYCLE) || null,
    tags: [g.cat, '조사통계', '연간'], raw_meta: g.meta || null, status: 'active',
  });
  g.tables.forEach((t, i) => statistic_tables.push({
    id: randomUUID(), statistic_id: id, kosis_org_id: t.kosis_org_id, kosis_tbl_id: t.kosis_tbl_id,
    table_name: t.table_name, category_path: t.category_path, is_representative: i === 0,
    display_order: i, kosis_url: t.kosis_url,
    latest_period: ['2024','2025.08','2026 1/2','2025 3/4','20250815'][i % 5],
  }));
  gi++;
}
// 흡수되어 사라진 옛 조사 3건 (화면에 보이면 안 됨)
for (const nm of ['전체대상', '가공통계', '총액 분포']) {
  statistics.push({ id: randomUUID(), stat_id: nm, name_ko: nm, agency: '국가데이터처',
    org_id: '101', category: '사회일반', tags: null, raw_meta: null, status: 'merged' });
}
const TABLES = {
  statistics,
  statistic_tables,
  statistic_history: [],
  statistic_events: [],
  curated_sets: [],
  curated_set_items: [],
  deep_dive_articles: [],
};
// 실제 DB에 없을 가능성이 있는 컬럼 (요청되면 42703 로 거절해 폴백 경로를 검증)
const MISSING_COLUMNS = new Set(['name_en', 'tags', 'updated_at', 'search_vector']);

const send = (res, code, body, extra = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/rest\/v1\/([A-Za-z_]+)$/);
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    return send(res, 404, { code: 'PGRST202', message: 'Could not find the function public.search_all in the schema cache' });
  }
  if (!m) return send(res, 404, { message: 'not found' });
  const name = m[1];
  if (!(name in TABLES)) {
    return send(res, 404, { code: '42P01', message: `relation "public.${name}" does not exist` });
  }

  const select = url.searchParams.get('select') || '*';
  if (select !== '*') {
    const cols = select.split(',').map((c) => c.trim());
    const bad = cols.find((c) => MISSING_COLUMNS.has(c));
    if (bad) return send(res, 400, { code: '42703', message: `column statistics.${bad} does not exist` });
  }
  let rows = TABLES[name].slice();

  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    if (v.startsWith('eq.')) {
      const want = v.slice(3);
      rows = rows.filter((r) => String(r[k]) === want || (want === 'true' && r[k] === true));
    } else if (v.startsWith('neq.')) {
      const want = v.slice(4);
      rows = rows.filter((r) => String(r[k]) !== want);
    } else if (v.startsWith('in.')) {
      const list = v.slice(3).replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      rows = rows.filter((r) => list.includes(String(r[k])));
    } else if (v.startsWith('ilike.')) {
      const pat = v.slice(6).replace(/\*/g, '').replace(/%/g, '').toLowerCase();
      rows = rows.filter((r) => String(r[k] ?? '').toLowerCase().includes(pat));
    } else if (k === 'or') {
      const parts = v.replace(/^\(|\)$/g, '').split(',');
      rows = rows.filter((r) => parts.some((p) => {
        const [col, op, ...rest] = p.split('.');
        const arg = rest.join('.');
        if (op === 'is') return arg === 'null' ? (r[col] === null || r[col] === undefined) : String(r[col]) === arg;
        if (op === 'neq') return String(r[col] ?? '') !== arg;
        if (op === 'eq') return String(r[col] ?? '') === arg;
        if (op === 'ilike') {
          const pat = arg.replace(/\*/g, '').replace(/%/g, '').toLowerCase();
          return String(r[col] ?? '').toLowerCase().includes(pat);
        }
        return false;
      }));
    }
  }

  const orders = url.searchParams.getAll('order');
  for (const o of orders.slice().reverse()) {
    for (const part of o.split(',').reverse()) {
      const [col, dir] = part.split('.');
      if (rows.length && !(col in rows[0])) {
        return send(res, 400, { code: '42703', message: `column ${name}.${col} does not exist` });
      }
      const sign = dir === 'desc' ? -1 : 1;
      rows.sort((a, b) => sign * String(a[col] ?? '').localeCompare(String(b[col] ?? ''), 'ko'));
    }
  }

  const total = rows.length;
  const range = req.headers['range'];
  if (range) {
    const [from, to] = range.split('-').map(Number);
    rows = rows.slice(from, to + 1);
  }
  const limit = url.searchParams.get('limit');
  if (limit) rows = rows.slice(0, Number(limit));

  const headers = { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${total}` };
  if (req.method === 'HEAD') { res.writeHead(200, headers); return res.end(); }
  send(res, 200, rows, headers);
}).listen(54321, () => console.log('mock postgrest on 54321  statistics=' + statistics.length + ' tables=' + statistic_tables.length));
