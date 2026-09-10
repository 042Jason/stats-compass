/**
 * 바깥에 따로 배포된 Deep Dive.
 *
 * deep_dive_articles 테이블은 <우리가 쓴 글>을 담습니다. 남이 만든 사이트를
 * 거기에 억지로 밀어 넣으면 slug·본문·발행일 같은 칸이 전부 빈 채로 남고,
 * /deep-dives/[slug] 는 열리지도 않습니다. 그래서 종류를 나눠 둡니다.
 *
 * 늘리기는 이 배열에 한 칸 더 적으면 됩니다.
 */
export interface ExternalDeepDive {
  key: string;
  title: string;
  subtitle: string;
  /** 목록 카드에 보일 소개. 3~4줄이 적당합니다. */
  summary: string;
  /** 카드 아래에 붙는 짧은 꼬리표 */
  tags: string[];
  url: string;
  /** 어디가 만들었는지. 외부 링크라 밝혀 둡니다. */
  publisher: string;
  /** public/ 아래 경로. 파일이 없으면 대체 커버가 대신 뜹니다. */
  cover: string;
  coverAlt: string;
}

export const EXTERNAL_DEEP_DIVES: ExternalDeepDive[] = [
  {
    key: "lifecompass",
    title: "LifeCompass — 생애주기 통계 나침반",
    subtitle: "0세부터 60대 이상까지, 소득·고용·주거·자산을 한 줄기로",
    summary:
      "KOSIS 공식 통계표 136개를 7대 생애주기 타임라인 하나로 묶은 대시보드입니다. 단계마다 핵심 지표와 원천통계를 붙여 두어, 지금 보고 있는 숫자가 어느 통계에서 나온 것인지 바로 확인할 수 있습니다. 초혼연령·주거비 부담·육아휴직 급여 같은 정책 레버 21개를 움직이면 2040년까지의 곡선이 그 자리에서 다시 그려지고, '청년 실업률은 내려갔는데 왜 체감은 그대로인가' 같은 오해도 단계별로 짚어 줍니다.",
    tags: ["KOSIS 136개 표", "7대 생애주기", "What-If 시뮬레이터", "정책 레버 21개"],
    url: "https://lifecompass-d1x.pages.dev/",
    publisher: "국가데이터처",
    cover: "/deep-dives/lifecompass-cover.png",
    coverAlt: "LifeCompass 홈 화면 — 생애주기 타임라인과 단계별 지표 대시보드",
  },
];
