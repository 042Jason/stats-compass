/**
 * 국가데이터처 보도자료 수집
 *
 * mods.go.kr(구 kostat.go.kr)은 조사별로 보도자료 게시판이 나뉘어 있습니다.
 * 검색 대신 게시판(bid)을 직접 훑으면 정밀도가 100% 라 하루짜리 수집에 적합합니다.
 * robots.txt 상 /board.es 경로는 모든 봇에 허용돼 있습니다.
 *
 *   npx tsx src/seed/14_fetchNews.ts --probe          # HTML 구조만 확인 (저장 안 함)
 *   npx tsx src/seed/14_fetchNews.ts --dry-run
 *   npx tsx src/seed/14_fetchNews.ts --pages 3
 *
 * 게시판 지도는 data/seed/13_newsBoards.json 에 있습니다.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

const BOARDS_FILE = 'data/seed/13_newsBoards.json';
const OUT_FILE = 'data/seed/14_news.json';

const DRY = process.argv.includes('--dry-run');
const PROBE = process.argv.includes('--probe');
const PAGES = (() => {
  const i = process.argv.indexOf('--pages');
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 2) : 2;
})();

/** 예의상 요청 간격 */
const DELAY_MS = 1600;

interface BoardsFile {
  listUrl: string;
  viewUrl: string;
  boards: Array<{ survey: string; bid: string; titleHints: string[] }>;
}

interface Article {
  source: string;
  board_id: string;
  list_no: string;
  title: string;
  url: string;
  published_on: string | null;
  department: string | null;
  summary: string | null;
  survey_name: string;
  raw: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stripTags = (html: string): string =>
  html
    // 주석을 먼저 지워야 합니다. 태그 정규식만 돌리면 '-->' 가 텍스트로 남습니다.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      // 기관 사이트가 기본 UA 를 막는 경우가 있어 일반 브라우저 UA 를 씁니다.
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'accept-language': 'ko-KR,ko;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

/**
 * 목록 HTML 에서 게시글을 뽑습니다.
 *
 * 두 가지를 조심해야 합니다.
 *   ① 페이지 곳곳에 HTML 주석이 있어 먼저 지우지 않으면 제목에 '-->' 가 딸려옵니다.
 *   ② 게시일이 제목 앵커 바깥의 <li> 에 있어서, 행을 <li> 로 쪼개면 날짜가 잘려 나갑니다.
 * 그래서 레코드 경계를 `addSearchParam(` 호출 지점으로 잡습니다. 제목 링크가 거기 있습니다.
 */
function parseList(html: string): Array<{ listNo: string; title: string; date: string | null }> {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const chunks = clean.split('addSearchParam(');
  const out: Array<{ listNo: string; title: string; date: string | null }> = [];
  const seen = new Set<string>();

  for (const chunk of chunks.slice(1)) {
    const idm = chunk.match(/list_no=(\d+)/);
    if (!idm) continue;
    const listNo = idm[1];
    if (seen.has(listNo)) continue;

    // 앵커 안쪽 텍스트가 제목입니다.
    const am = chunk.match(/>([\s\S]{0,400}?)<\/a>/);
    const title = am ? stripTags(am[1]) : '';
    if (!title || title.length < 4) continue;

    // 같은 레코드 안에서 첫 날짜를 게시일로 봅니다.
    const dm = chunk.slice(0, 3000).match(/(20\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
    const date = dm
      ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`
      : null;

    seen.add(listNo);
    out.push({ listNo, title, date });
  }
  return out;
}

/** 상세 페이지에서 담당부서와 본문 앞부분을 뽑습니다. 실패해도 치명적이지 않습니다. */
function parseView(html: string): { department: string | null; summary: string | null } {
  const dep =
    html.match(/담당\s*부서[^<]*<[^>]*>\s*([^<]{2,30})/)?.[1] ??
    html.match(/담당부서[^가-힣]{0,20}([가-힣]{2,20}(?:과|팀|국|처))/)?.[1] ??
    null;

  const body = stripTags(html);
  const i = body.indexOf('첨부파일');
  const text = (i > 0 ? body.slice(i + 4) : body).trim();
  const summary = text.length > 40 ? text.slice(0, 400) : null;

  return { department: dep ? dep.trim() : null, summary };
}

async function main(): Promise<void> {
  const cfg: BoardsFile = JSON.parse(readFileSync(BOARDS_FILE, 'utf-8'));
  const all: Article[] = [];
  const byUrl = new Set<string>();

  if (PROBE) {
    const b = cfg.boards[0];
    const url = cfg.listUrl.replace('{bid}', b.bid).replace('{page}', '1');
    log.info(`probe: ${url}`);
    const html = await get(url);
    writeFileSync('data/seed/14_probe.html', html, 'utf-8');
    const rows = parseList(html);
    log.info(`HTML ${html.length}자 -> data/seed/14_probe.html`);
    log.info(`파싱 결과 ${rows.length}건`);
    for (const r of rows.slice(0, 5)) log.info(`   ${r.date ?? '-'} | ${r.listNo} | ${r.title}`);
    if (rows.length === 0) log.warn('파싱 실패 — 14_probe.html 을 열어 마크업을 확인하세요');
    return;
  }

  for (const b of cfg.boards) {
    let hit = 0;
    let miss = 0;
    for (let page = 1; page <= PAGES; page++) {
      const url = cfg.listUrl.replace('{bid}', b.bid).replace('{page}', String(page));
      let html: string;
      try {
        html = await get(url);
      } catch (e) {
        log.warn(`  ${b.survey} p${page} 실패: ${String(e)}`);
        break;
      }
      const rows = parseList(html);
      if (rows.length === 0) break;

      for (const r of rows) {
        // 게시판 bid 가 어긋났을 수 있어 제목으로 한 번 더 거릅니다.
        const ok = b.titleHints.some((h) => r.title.includes(h));
        if (!ok) {
          miss++;
          continue;
        }
        hit++;
        const viewUrl = cfg.viewUrl.replace('{bid}', b.bid).replace('{listNo}', r.listNo);
        if (byUrl.has(viewUrl)) continue;
        byUrl.add(viewUrl);
        all.push({
          source: 'mods.go.kr',
          board_id: b.bid,
          list_no: r.listNo,
          title: r.title,
          url: viewUrl,
          published_on: r.date,
          department: null,
          summary: null,
          survey_name: b.survey,
          raw: { page, titleHints: b.titleHints },
        });
      }
      await sleep(DELAY_MS);
    }
    const rate = hit + miss > 0 ? Math.round((hit / (hit + miss)) * 100) : 0;
    if (hit === 0) log.warn(`  ${b.survey} (bid=${b.bid}) — 적중 0건. bid 가 틀렸을 수 있습니다`);
    else log.info(`  ${b.survey}: ${hit}건 (적중률 ${rate}%)`);
  }

  log.info(`수집 ${all.length}건`);
  writeFileSync(OUT_FILE, JSON.stringify(all, null, 1), 'utf-8');
  log.ok(`스냅샷 -> ${OUT_FILE}`);

  if (DRY) {
    log.warn('--dry-run 이므로 DB 를 수정하지 않았습니다.');
    return;
  }

  for (let i = 0; i < all.length; i += 300) {
    const { error } = await supabase
      .from('news_articles')
      .upsert(all.slice(i, i + 300), { onConflict: 'source,url' });
    if (error) throw error;
    log.info(`  저장 ${Math.min(i + 300, all.length)}/${all.length}`);
  }
  log.ok(`완료 — 보도자료 ${all.length}건`);
}

main().catch((e) => {
  log.err(String(e instanceof Error ? (e.stack ?? e.message) : e));
  process.exit(1);
});
