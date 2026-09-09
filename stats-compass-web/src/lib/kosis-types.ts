/**
 * KOSIS 응답 타입. 클라이언트에서도 씁니다.
 *
 * `kosis.ts` 는 `server-only` 를 임포트하므로 클라이언트 컴포넌트에서 못 가져옵니다.
 * 타입만 여기로 빼서 양쪽이 같은 모양을 보게 합니다.
 */

export interface KosisPoint {
  period: string;
  /** 계산·막대에 쓰는 수치. 시:분 표기는 분으로 환산해 둡니다 */
  value: number | null;
  /**
   * 화면에 그대로 띄울 원래 표기.
   *
   * KOSIS 의 DT 가 늘 숫자는 아닙니다. 생활시간조사는 `9:24`(시:분)로 오고,
   * 통계부호(`-`, `…`, `X`)가 오기도 합니다. 숫자로만 다루면 화면이 전부
   * `—` 가 됩니다. 표기는 원문대로 보여 주고 계산만 value 로 합니다.
   */
  text: string | null;
}

/** 통계표의 분류 축 하나. objL1, objL2 … 에 무엇을 넣었는지 화면에 밝히기 위한 것 */
export interface KosisDim {
  /** objL 슬롯 번호 (1부터) */
  slot: number;
  /** KOSIS 의 OBJ_ID. 예: A, B, HJG */
  objId: string;
  /** 분류명. 예: 시도별, 연령별 */
  name: string;
  /** 실제로 넘긴 값. 총계 코드거나 "ALL" */
  chosen: string;
  /** 그 코드의 이름. 예: 계 */
  chosenName: string;
}

export interface KosisSeries {
  orgId: string;
  tblId: string;
  /** KOSIS 가 돌려준 통계표명. 우리 DB 의 이름과 다를 수 있어 그대로 보여 줍니다 */
  tableName: string | null;
  /** 고른 계열의 이름. "계 · 계 · 남편" 처럼 분류값을 이어 붙인 것 */
  seriesName: string;
  unit: string | null;
  points: KosisPoint[];
  /** 응답에 들어 있던 계열 수. 1개만 보여 준다는 사실을 알리는 용도 */
  seriesTotal: number;
  /** 계열을 바꿔 고른 사유. 화면에 그대로 띄웁니다 */
  seriesNote: string | null;
  /** 값이 시:분 표기인가. 증감을 "분" 으로 보여 주기 위한 것 */
  isDuration: boolean;
  /** 이 표의 분류 축과 우리가 고른 값 */
  dims: KosisDim[];
  /** 실제로 호출에 쓴 주기. 요청한 주기가 없으면 다른 것으로 바뀝니다 */
  prdSeUsed: string;
  /** 이 표가 수록하는 주기들 */
  availablePrd: string[];
  error: string | null;
}

/** 주기 코드 → 사람이 읽는 말 */
export const PRD_LABEL: Record<string, string> = {
  Y: "연간",
  H: "반기",
  Q: "분기",
  M: "월간",
  D: "일간",
  IR: "부정기",
  F: "다년",
};

/** KOSIS 시점 코드를 읽기 좋게. 2023 / 202301 / 20230101 형태가 옵니다. */
export function formatPeriod(prd: string, prdSe: string): string {
  if (/^\d{4}$/.test(prd)) return `${prd}년`;
  if (/^\d{6}$/.test(prd)) {
    const y = prd.slice(0, 4);
    const n = Number(prd.slice(4));
    if (prdSe === "Q") return `${y} ${n}분기`;
    if (prdSe === "H") return `${y} ${n === 1 ? "상" : "하"}반기`;
    return `${y}.${String(n).padStart(2, "0")}`;
  }
  if (/^\d{8}$/.test(prd)) return `${prd.slice(0, 4)}.${prd.slice(4, 6)}.${prd.slice(6)}`;
  return prd;
}
