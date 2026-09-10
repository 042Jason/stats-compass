/**
 * 자유 질문에서 나이·성별을 뽑아냅니다.
 *
 * 지역은 여기서 정규식으로 잡지 않습니다. `resolve_region(text)` 이 문장 전체를 받아
 * Region 노드의 라벨·별칭과 대조하므로, 지역명 목록을 코드에 또 복사할 이유가 없습니다.
 * 나이·성별만 정규식이 필요합니다.
 */

export interface ParsedSlots {
  /** "35살" → 35, "50대" → 55 (구간 중앙값) */
  age: number | null;
  /** 나이를 어떤 표현에서 뽑았는지. 화면에 근거로 보여 줍니다 */
  ageText: string | null;
  sex: "남성" | "여성" | null;
  sexText: string | null;
}

/* "35살", "35 세". "3세대" 같은 말에 걸리지 않도록 뒤에 '대'가 오면 제외합니다. */
const RE_AGE = /(\d{1,2})\s*[살세](?!대)/;
/* "30대", "50 대". "20대학생" 같은 말은 제외합니다. */
const RE_DECADE = /(?:^|[^\d])([1-9]0)\s*대(?!학)/;
const RE_MALE = /남(자|성|편)?\b|남자|남성/;
const RE_FEMALE = /여(자|성)|아내|와이프/;

export function parseSlots(question: string): ParsedSlots {
  const q = question ?? "";

  let age: number | null = null;
  let ageText: string | null = null;

  const m1 = RE_AGE.exec(q);
  if (m1) {
    age = Number(m1[1]);
    ageText = m1[0].trim();
  } else {
    const m2 = RE_DECADE.exec(q);
    if (m2) {
      // "50대" 는 50~59세입니다. 구간 중앙인 55로 잡아야
      // resolve_age 가 10세 구간을 제대로 집어냅니다.
      age = Number(m2[1]) + 5;
      ageText = `${m2[1]}대`;
    }
  }
  if (age !== null && (age < 0 || age > 120)) {
    age = null;
    ageText = null;
  }

  // 여성 표현을 먼저 봅니다. "남녀" 같은 말에서 남성으로 새는 것을 줄입니다.
  let sex: ParsedSlots["sex"] = null;
  let sexText: string | null = null;
  const f = RE_FEMALE.exec(q);
  const m = RE_MALE.exec(q);
  if (f) {
    sex = "여성";
    sexText = f[0];
  } else if (m) {
    sex = "남성";
    sexText = m[0];
  }

  return { age, ageText, sex, sexText };
}

/** 해석된 슬롯 — 정규식 결과에 DB 조회 결과를 합친 것 */
export interface ResolvedSlots extends ParsedSlots {
  ageBands: string[];
  stages: Array<{ key: string; label: string }>;
  regions: Array<{ code: string; label: string; level: string | null; matched: string | null }>;
}

export const EMPTY_SLOTS: ResolvedSlots = {
  age: null,
  ageText: null,
  sex: null,
  sexText: null,
  ageBands: [],
  stages: [],
  regions: [],
};

/** 슬롯이 하나라도 잡혔는가 */
export function hasAnySlot(s: ResolvedSlots): boolean {
  return s.age !== null || s.sex !== null || s.regions.length > 0;
}

/* ────────────────────────────────────────────────────────────────
 * 질의 낱말 → 통계표 제목 낱말
 * ────────────────────────────────────────────────────────────────
 *
 * 사람은 "빚" 이라 하고 통계표는 "대출잔액" 이라 씁니다. 글자가 하나도 안 겹치니
 * 어휘 검색은 못 잡고, 벡터는 긴 제목과 짧은 낱말을 잘 못 맞춥니다. 그래서
 * "집 살 때 빚" 질문에 대출 통계표가 한 건도 안 붙었습니다.
 *
 * 조사·지표를 찾는 일(별칭 사전)과는 다른 층입니다. 이건 <표 제목에 실제로 쓰이는 말>로
 * 옮기는 사전입니다. 표 제목은 행정 용어라 구어체와 어휘가 크게 다릅니다.
 *
 * 늘리는 게 어렵지 않습니다. 왼쪽에 사람 말, 오른쪽에 표 제목에 나오는 말을 적으면 됩니다.
 */
const TITLE_WORDS: Record<string, string[]> = {
  빚: ["대출", "부채"],
  대출: ["대출", "부채"],
  부채: ["부채", "대출"],
  빌린: ["대출", "부채"],
  갚: ["상환", "연체"],
  연체: ["연체"],

  집: ["주택", "거처"],
  주택: ["주택"],
  아파트: ["주택", "아파트"],
  전세: ["전세", "임차", "보증금"],
  월세: ["월세", "임차"],
  자가: ["자가", "주택소유"],
  내집: ["주택소유", "자가"],

  월급: ["소득", "임금"],
  봉급: ["소득", "임금"],
  연봉: ["소득", "임금"],
  임금: ["임금", "소득"],
  소득: ["소득"],
  버는: ["소득"],
  생활비: ["소비지출", "생활비"],
  씀씀이: ["소비지출"],

  자산: ["자산", "순자산"],
  재산: ["자산", "순자산"],
  저축: ["저축", "예금"],

  은퇴: ["은퇴", "노후", "연금"],
  노후: ["노후", "연금"],
  연금: ["연금"],
  퇴직: ["퇴직", "은퇴"],

  결혼: ["혼인", "신혼"],
  신혼: ["신혼", "혼인"],
  이혼: ["이혼"],
  출산: ["출생", "출산"],
  육아: ["육아", "보육"],
  사교육: ["사교육"],
  학원: ["사교육"],
  교육비: ["교육비", "사교육"],

  일자리: ["일자리", "취업"],
  취업: ["취업", "일자리"],
  실업: ["실업"],
  창업: ["창업", "자영업"],
};

/**
 * 질의에서 통계표 제목에 부딪힐 낱말을 뽑습니다.
 *
 * 사전에 있는 말은 표 제목 어휘로 바꾸고, 사전에 없어도 두 글자 이상 한글 덩어리는
 * 그대로 넣습니다. 표 제목이 그 말을 쓰고 있을 수 있기 때문입니다.
 */
export function titleKeywords(question: string): string[] {
  const out = new Set<string>();

  for (const [k, words] of Object.entries(TITLE_WORDS)) {
    if (question.includes(k)) for (const w of words) out.add(w);
  }

  // 조사·어미가 붙은 채로도 부분일치가 되므로 굳이 형태소 분석을 하지 않습니다.
  for (const m of question.matchAll(/[가-힣]{2,}/g)) {
    const t = m[0];
    if (t.length >= 2 && t.length <= 6 && !STOP.has(t)) out.add(t);
  }

  return [...out].slice(0, 12);
}

/** 어디에나 붙어서 아무 표에나 걸리는 말 */
const STOP = new Set([
  "얼마", "얼마나", "정도", "무엇", "어떤", "어디", "언제", "누가", "이거", "그거",
  "거주", "사는", "삽니다", "인데", "인가요", "할까요", "될까요", "하나요", "궁금",
  "알려", "알고", "싶어", "싶습니다", "좀", "제가", "저는", "우리", "요즘", "보통",
  "평균", "현황", "관련", "대해", "대한", "통계", "자료", "데이터",
]);
