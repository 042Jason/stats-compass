/**
 * 검색 단계 정의 — 진행 표시와 그래프 뷰가 같은 것을 씁니다.
 *
 * 두 곳에 따로 적어 두면 문구가 어긋납니다. 진행 막대는 4단계인데 그래프는
 * 5열이면, 보는 사람은 둘이 같은 과정인지 알 수 없습니다.
 *
 * 열 = 단계입니다. 검색 중에는 이 순서로 켜지고, 결과가 오면 같은 순서로
 * 실제 노드가 채워집니다.
 */

export interface SearchStep {
  /** 그래프 열 머리글 */
  title: string;
  /** 진행 중 보여 줄 한 줄 설명 */
  caption: string;
}

export const SEARCH_STEPS: readonly SearchStep[] = [
  { title: "질문 조각", caption: "질문에서 나이·지역·성별을 떼어냅니다" },
  { title: "걸린 노드", caption: "별칭과 본문으로 가까운 노드를 찾습니다 (어휘 + 벡터)" },
  { title: "통계", caption: "온톨로지 관계를 타고 통계에 도달합니다" },
  { title: "통계용어", caption: "통계들이 공유하는 통계용어가 서로를 잇습니다" },
  { title: "통계표", caption: "통계마다 대표표를 골라 KOSIS 로 넘길 ID를 확정합니다" },
];

/** 한 단계가 켜지는 간격 */
export const STEP_MS = 700;
