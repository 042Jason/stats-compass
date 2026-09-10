/**
 * 국가데이터처 "통계별질문" 게시판 수집
 *
 * 이 게시판은 <국가데이터처가 직접 정리해 둔 혼동 목록>입니다.
 * "가구·세대·가족의 개념 차이는?", "실업률은 하락했는데 왜 고용률은 상승하지 않나요?"
 * 같은 문항이 조사별로 쌓여 있습니다. 우리가 손으로 추측할 이유가 없습니다.
 *
 *   npx tsx src/seed/19_fetchFaq.ts              목록만 (빠름)
 *   npx tsx src/seed/19_fetchFaq.ts --body       본문까지 (건당 1회 호출)
 *   → data/seed/19_faq.json
 *
 * 수집한 뒤에는 사람이 읽고 골라 엑셀(17/18)로 개념·혼동관계를 넣는 흐름입니다.
 * 자동으로 온톨로지에 밀어넣지 않습니다 — 문항 제목만으로는 어느 개념 쌍인지
 * 기계가 정확히 못 가릅니다. 골라내는 건 사람 몫입니다.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { log } from '../utils/logger.js';

const BASE = 'https://mods.go.kr';
const OUT = 'data/seed/19_faq.json';
const WITH_BODY = process.argv.includes('--body');

/** 통계별질문 분야별 "전체" 목록 mid. 이 화면에 조사별 항목이 다 모여 있습니다. */
const CATEGORIES: Array<{ mid: string; name: string }> = [
  { mid: 'a10502020100', name: '인구 · 가구' },
  { mid: 'a10502030100', name: '고용 · 노동' },
  { mid: 'a10502040100', name: '물가 · 가계' },
  { mid: 'a10502050100', name: '산업활동' },
  { mid: 'a10502060100', name: '보건 · 사회 · 복지' },
  { mid: 'a10502070100', name: '교육' },
  { mid: 'a10502080100', name: '농림어업' },
  { mid: 'a10502090100', name: '광업제조업 · 기업활동' },
  { mid: 'a10502100100', name: '건설 · 주택' },
  { mid: 'a10502110100', name: '교통' },
  { mid: 'a10502120100', name: '도소매 · 서비스' },
  { mid: 'a10502130100', name: '국민계정 · 지역계정' },
  { mid: 'a10502140100', name: '국제통계' },
  { mid: 'a10502150100', name: '기타' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

export interface FaqItem {
  category: string;
  survey: string | null;
  title: string;
  url: string;
  views: number | null;
  body?: string;
}

/**
 * 목록 파싱.
 *
 * 14_fetchNews.ts 와 같은 함정이 있습니다.
 *   ① HTML 주석을 먼저 지우지 않으면 제목에 "--> --> -->" 가 섞입니다.
 *   ② <li> 로 자르면 조회수가 다른 조각으로 떨어져 나갑니다.
 * 그래서 주석을 먼저 없애고 addSearchParam( 기준으로 자릅니다.
 */
function parseList(html: string, category: string): FaqItem[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const out: FaqItem[] = [];

  for (const chunk of clean.split('addSearchParam(').slice(1)) {
    const hrefM = chunk.match(/^['"]([^'"]+)['"]/);
    if (!hrefM) continue;
    const href = hrefM[1].replace(/&amp;/g, '&');
    if (!href.includes('act=view')) continue;

    const titleM = chunk.match(/>([\s\S]{0,400}?)<\/a>/);
    const title = titleM ? stripTags(titleM[1]) : '';
    if (!title) continue;

    const viewM = chunk.slice(0, 2000).match(/조회수[^0-9]{0,20}([0-9,]+)/);
    out.push({
      category,
      survey: null,
      title,
      url: href.startsWith('http') ? href : `${BASE}${href}`,
      views: viewM ? Number(viewM[1].replace(/,/g, '')) : null,
    });
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; stats-compass/1.0)' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** 상세 페이지에서 답변 본문만. 게시글 영역이 만족도 조사 앞에서 끝납니다. */
function parseBody(html: string): string {
  const clean = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const cut = clean.split('콘텐츠 만족도')[0];
  const marks = [...cut.matchAll(/○[^○<]{5,400}/g)].map((m) => stripTags(m[0]));
  if (marks.length > 0) return marks.join('\n');
  const tail = stripTags(cut).slice(-1200);
  return tail;
}

async function main() {
  const all: FaqItem[] = [];

  for (const cat of CATEGORIES) {
    let got = 0;
    for (let page = 1; page <= 10; page++) {
      const url = `${BASE}/board.es?mid=${cat.mid}&nPage=${page}`;
      let html: string;
      try {
        html = await fetchText(url);
      } catch (e) {
        log.warn(`${cat.name} ${page}쪽 실패: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      const items = parseList(html, cat.name);
      // 같은 항목이 다시 나오면 마지막 쪽입니다.
      const fresh = items.filter((i) => !all.some((a) => a.url === i.url));
      if (fresh.length === 0) break;
      all.push(...fresh);
      got += fresh.length;
      await sleep(400);
    }
    log.info(`${cat.name} — ${got}건`);
  }

  log.info(`합계 ${all.length}건`);

  if (WITH_BODY) {
    log.info('본문 수집 시작 (건당 0.4초)');
    for (let i = 0; i < all.length; i++) {
      try {
        all[i].body = parseBody(await fetchText(all[i].url));
      } catch {
        all[i].body = '';
      }
      if ((i + 1) % 25 === 0) log.info(`  ${i + 1}/${all.length}`);
      await sleep(400);
    }
  }

  /* 개념 차이를 다루는 문항을 앞으로 올려 둡니다. 사람이 훑을 때 편하도록. */
  const RE_DIFF = /차이|구분|다른가|다릅|무엇이 다|개념|기준은|란\?|이란|무엇인가/;
  all.sort((a, b) => {
    const da = RE_DIFF.test(a.title) ? 0 : 1;
    const db = RE_DIFF.test(b.title) ? 0 : 1;
    return da - db || (b.views ?? 0) - (a.views ?? 0);
  });

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(all, null, 2), 'utf8');
  log.ok(`${OUT} 저장 — ${all.length}건 (개념·차이 문항 ${all.filter((x) => RE_DIFF.test(x.title)).length}건)`);
  log.info('읽어 보고 쓸 것을 골라 17/18 엑셀로 개념·혼동관계를 넣으세요.');
}

main().catch((e) => {
  log.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
