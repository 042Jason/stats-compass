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
