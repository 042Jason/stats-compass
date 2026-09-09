/**
 * 주제 태그 자동 생성 (가중치 방식)
 *
 *   조사명에서 매칭      : 3점  (강한 근거)
 *   통계분야/카테고리     : 2점
 *   조사항목/조사대상 설명 : 1점  (약한 근거 — 단독으로는 태그하지 않음)
 *
 * 합계 2점 이상만 채택합니다. 조사대상 설명문에 '전국 가구' 처럼 스쳐 나온
 * 단어까지 태그로 잡히던 문제를 막기 위한 장치입니다.
 */
const TAG_RULES: Array<[string, RegExp]> = [
  ['인구', /인구(?!이동)|주민등록|인구주택총조사/],
  ['출생·사망', /출생|사망|생명표|기대수명/],
  ['혼인·이혼', /혼인|이혼|신혼부부/],
  ['인구이동', /인구이동|이동자|전입|전출/],
  ['장래인구추계', /추계|장래/],
  ['가구·가족', /가구주|1인가구|가족|가구원|세대구성/],
  ['고령화', /고령|노인|65세/],
  ['아동·청소년', /아동|청소년|어린이|영유아/],
  ['외국인', /외국인|이민|귀화|다문화/],

  ['고용', /고용|취업자|경제활동인구|일자리|근로형태/],
  ['실업', /실업|구직/],
  ['임금·근로', /임금|급여|근로실태|근로시간|노동비용|노동생산성/],
  ['생활시간', /생활시간/],

  ['물가', /물가|가격지수|쌀값/],
  ['소득·자산', /소득|자산|부채|가계금융|분배|지니|빈곤/],
  ['소비지출', /소비|지출|가계동향/],
  ['국민계정', /국민계정|국내총생산|GDP|국부|위성계정|산업연관|지역소득|이전계정/],
  ['경기지표', /경기|동행지수|선행지수|종합지수|기업경기|소비자동향|설비투자/],

  ['제조업', /제조업|광공업|가동률|생산능력|기계수주/],
  ['광업', /광업/],
  ['건설', /건설|기성|수주/],
  ['서비스업', /서비스업|도소매|소매판매|온라인쇼핑|프랜차이즈|숙박|음식점/],
  ['기업·사업체', /사업체|기업|영리법인|창업|소상공인|자영업/],
  ['무역·수출입', /수출|수입|무역|교역/],

  ['농업', /농가|농업|경지|농작물|양곡|축산|가축|농산물|미곡|벼|재배면적|과수|채소|귀농|귀촌|생산비/],
  ['어업·수산', /어업|수산|양식|어가|어획|귀어|귀농어/],
  ['임업', /임업|산림|목재|버섯/],

  ['주택·주거', /주택|주거|전세|월세|임대/],
  ['건강·의료', /건강|의료|질병|사망원인|보건/],
  ['교육', /교육|학교|학생|교원|사교육/],
  ['직업훈련', /직업훈련|직업능력|훈련과정/],
  ['복지', /복지|기초생활|연금|보육/],
  ['사회조사', /사회조사|삶의질|사회지표|웰빙/],
  ['안전·범죄', /범죄|재해|재난|안전/],
  ['환경·에너지', /환경|에너지|온실가스|폐기물|탄소/],
  ['정보통신', /정보통신|디지털|과학기술|연구개발/],
  ['교통·물류', /교통|물류|운송|화물|자동차/],
  ['지역통계', /시도별|지역별|시군구/],
];

const CYCLE_MAP: Record<string, string> = {
  월: '월간', 분기: '분기', '1년': '연간', 년: '연간', 반기: '반기',
  '5년': '5년주기', '2년': '2년주기', '3년': '3년주기', '순기(10일)': '순기',
};

/**
 * 카테고리와 사실상 같은 뜻인 주제 태그는 버립니다.
 * 예) 카테고리 '주거' + 태그 '주택·주거', 카테고리 '교육·훈련' + 태그 '교육'
 */
function redundantWith(tag: string, category: string): boolean {
  if (!category) return false;
  const parts = (s: string) => s.split(/[·ㆍ]/).map((x) => x.trim()).filter(Boolean);
  const t = parts(tag);
  const c = parts(category);
  if (t.length === 0 || c.length === 0) return false;
  // 부분 일치로 보면 카테고리 '인구' 가 더 구체적인 '인구이동' 까지 잡아먹습니다.
  // 토큰이 완전히 같을 때만 중복으로 판단합니다.
  const allIn = (xs: string[], ys: string[]) => xs.every((x) => ys.includes(x));
  return allIn(t, c) || allIn(c, t);
}

export interface TagInput {
  name: string;
  category?: string | null;
  meta?: Record<string, unknown> | null;
}

export function buildTags(input: TagInput, maxTopics = 5): string[] {
  const raw = (input.meta ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => String(v ?? '');

  const name = [input.name, str(raw.statsNm), str(raw.STAT_NM)].join(' ');
  const field = [str(raw.statsField), input.category ?? ''].join(' ');
  const detail = [str(raw.josaItm), str(raw.STATS_TARGET), str(raw.examinObjrange)].join(' ');

  const scored: Array<{ tag: string; score: number }> = [];
  for (const [tag, re] of TAG_RULES) {
    let score = 0;
    if (re.test(name)) score += 3;
    if (re.test(field)) score += 2;
    if (re.test(detail)) score += 1;
    if (score >= 2) scored.push({ tag, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const cat = (input.category ?? '').replace(/ㆍ/g, '·').trim();
  const out: string[] = [];
  if (cat) out.push(cat);
  for (const { tag } of scored) {
    if (out.length >= maxTopics + 1) break;
    if (!out.includes(tag) && !redundantWith(tag, cat)) out.push(tag);
  }

  const kind = str(raw.statsKind).trim();
  if (['조사통계', '가공통계', '보고통계'].includes(kind) && !out.includes(kind)) out.push(kind);
  const cycle = CYCLE_MAP[str(raw.COLLECT_CYCLE ?? raw.statsPeriod).trim()];
  if (cycle && !out.includes(cycle)) out.push(cycle);

  return out;
}
