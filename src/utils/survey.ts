/**
 * 통계표 → 소속 '조사(survey)' 이름
 *
 * ⚠️ KOSIS 통계목록 API(statisticsList.do)는 STAT_NM 을 돌려주지 않습니다.
 *    실제로 01_tables.json 의 stat_nm 은 1,378건 전부 빈 문자열입니다.
 *    조사명은 통계설명자료(getMeta)의 statsNm 에만 들어 있습니다.
 *
 * 규칙
 *   1) statsNm 이 있으면 그것이 정답 (1,378건 중 1,212건)
 *   2) 없으면 분류경로에서 '조사처럼 보이는' 가장 깊은 노드
 *      예) '사회일반 > 생애단계별행정통계 > 개인' -> 생애단계별행정통계
 *   3) 그래도 없으면 말단 노드
 */
const SURVEY_SUFFIX = /(조사|통계|총조사|센서스|계정|지수|생명표|추계|현황|동향)$/;

export interface TableLike {
  category_path?: string | null;
  /** 기관별 트리(MT_OTITLE) 1단계 노드명 — 있으면 이게 가장 정확합니다 */
  survey_name?: string | null;
  meta?: { statsNm?: string; STAT_NM?: string; [k: string]: unknown } | null;
}

export function surveyName(table: TableLike): string {
  // 0) 기관별 트리에서 받은 조사명이 최우선.
  //    KOSIS 가 101 하위 1단계를 조사 단위로 관리하므로 가장 신뢰할 수 있습니다.
  const fromTree = String(table.survey_name ?? '').trim();
  if (fromTree) return fromTree;

  const meta = table.meta ?? {};
  const s = String(meta.statsNm ?? meta.STAT_NM ?? '').trim();
  if (s) return s;

  const parts = String(table.category_path ?? '')
    .split(' > ')
    .map((x) => x.trim())
    .filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i--) {
    if (SURVEY_SUFFIX.test(parts[i])) return parts[i];
  }
  return parts[parts.length - 1] ?? '(미분류)';
}

/** 조사명 -> stat_id (한글 유지, 특수문자만 _ 로) */
export function toStatId(name: string): string {
  return name
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/* ------------------------------------------------------------------ */
/* 주제 카테고리                                                         */
/* ------------------------------------------------------------------ */

/** KOSIS 주제 대분류 15종 (DB 표기 기준 — 가운뎃점은 U+318D 'ㆍ') */
export const CATEGORIES = [
  '인구', '노동', '농림', '수산', '주거', '건설', '보건', '물가',
  '사회일반', '국민계정', '경제일반ㆍ경기', '광업ㆍ제조업',
  '도소매ㆍ서비스', '소득ㆍ소비ㆍ자산', '교육ㆍ훈련',
] as const;

/** statsField 는 '소득·소비·자산'(U+00B7) 로 오고 DB 는 'ㆍ'(U+318D) 를 씁니다 */
export function normalizeCategory(value: string): string {
  const v = value.replace(/·/g, 'ㆍ').trim();
  return (CATEGORIES as readonly string[]).includes(v) ? v : v;
}

/**
 * 조사명으로 주제 카테고리를 추정합니다.
 * 통계설명자료에 statsField 가 없는 조사(52개 중 17개)를 채우기 위한 폴백입니다.
 * 앞쪽 규칙이 우선하므로 구체적인 것부터 둡니다.
 */
const CATEGORY_RULES: Array<[string, RegExp]> = [
  ['물가', /물가|가격조사|쌀값|가격지수/],
  // 국민계정을 소득보다 먼저 — '국가자산통계' 가 '자산' 으로 소득에 잡히지 않도록
  ['국민계정', /국민계정|대차대조표|국부|국가자산|위성계정|이전계정|지역소득/],
  // 농림을 수산보다 먼저 — '농림어업조사' 가 '어업' 으로 수산에 잡히지 않도록
  ['농림', /농림|농[가업축]|축산|양곡|귀농|귀촌|벼|작물|재배면적|생산비/],
  ['수산', /어업|어류|수산|양식|어가/],
  ['보건', /생명표|사망|보건|건강|질병/],
  ['인구', /인구|주민등록|출생|혼인|이혼|가구추계|센서스/],
  ['주거', /주택|주거/],
  ['건설', /건설/],
  ['교육ㆍ훈련', /교육|사교육|학교|훈련/],
  ['광업ㆍ제조업', /광업|제조업|공급지수|기계수주/],
  ['도소매ㆍ서비스', /도소매|서비스업|온라인쇼핑|프랜차이즈|운수업|숙박|음식/],
  ['소득ㆍ소비ㆍ자산', /소득|소비|자산|가계금융|가계동향|연금/],
  ['경제일반ㆍ경기', /경기|생산지수|설비투자|경제총조사|기업|사업체|무역/],
  ['노동', /고용|일자리|임금|근로|경제활동인구|육아휴직|생활시간/],
  ['사회일반', /사회조사|생애단계|신혼부부|통계인력/],
];

export function guessCategory(surveyName: string): string {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(surveyName)) return cat;
  return '';
}
