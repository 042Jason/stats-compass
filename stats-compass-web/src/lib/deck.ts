import type { DeckCounts } from "@/lib/queries/deck";

/**
 * 발표 장표의 <내용>. 화면 구현과 떼어 둡니다.
 *
 * 발표 직전에 고칠 것은 거의 항상 문장입니다. 그때 React 컴포넌트를 열게 하면
 * 오타 하나 고치다 화면이 깨집니다. 여기만 고치면 됩니다.
 *
 * 숫자는 buildDeck 이 DB 실측값을 받아 채웁니다. 장표에 손으로 적지 마세요.
 */

export interface DeckStat {
  value: string;
  label: string;
  note?: string;
}

export interface DeckSlide {
  key: string;
  /** 좌상단 작은 글씨 */
  kicker: string;
  title: string;
  /** 제목 아래 한두 문장 */
  lead?: string;
  bullets?: string[];
  stats?: DeckStat[];
  /** 화살표로 잇는 단계. 파이프라인 장에 씁니다 */
  flow?: Array<{ step: string; detail: string }>;
  /** 좌우로 마주 놓는 비교. "사람 말 ↔ 표 제목" 같은 것 */
  versus?: { leftTitle: string; left: string[]; rightTitle: string; right: string[] };
  /** 맨 아래 회색 한 줄 */
  note?: string;
  /** 표지·마무리는 어둡게 */
  tone?: "cover" | "plain";
}

/** 숫자가 없으면 대시. 발표 중에 "0" 이 뜨는 것보다 낫습니다. */
function nf(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("ko-KR");
}

export function buildDeck(c: DeckCounts): DeckSlide[] {
  return [
    {
      key: "cover",
      tone: "cover",
      kicker: "국가데이터처 · 공공 × 데이터 × AI",
      title: "생애나침반",
      lead: "통계 이름을 몰라도 통계를 찾습니다. 사람의 질문을 온톨로지 그래프 위에서 풀어, 참고할 국가승인통계와 통계표를 근거와 함께 돌려주는 GraphRAG 검색입니다.",
      stats: [
        { value: nf(c.surveys), label: "국가승인통계" },
        { value: nf(c.tables), label: "KOSIS 통계표" },
        { value: nf(c.entities), label: "온톨로지 노드" },
        { value: nf(c.relations), label: "관계" },
      ],
      note: "위 숫자는 발표 시점에 DB에서 직접 센 값입니다.",
    },

    {
      key: "problem",
      kicker: "01 문제",
      title: "통계는 이미 다 있습니다. 이름을 모를 뿐입니다.",
      lead: "국가승인통계를 찾으려면 통계 이름을 먼저 알아야 합니다. 그런데 이름을 모르니까 찾는 것입니다.",
      versus: {
        leftTitle: "사람이 묻는 말",
        left: [
          "집을 사려면 빚을 얼마나 져야 하나",
          "은퇴하면 얼마가 필요한가",
          "학원비가 얼마나 드나",
        ],
        rightTitle: "통계표에 적힌 말",
        right: [
          "가구주 연령별 담보대출 보유액",
          "은퇴 후 필요 최소생활비",
          "월평균 사교육비 지출금액 구간별 분포",
        ],
      },
      note: "두 열은 글자가 하나도 겹치지 않습니다. 검색어 매칭으로는 영원히 못 만납니다.",
    },

    {
      key: "approach",
      kicker: "02 접근",
      title: "단어를 맞추지 않고, 그래프 위를 걷습니다.",
      lead: "질문과 통계표를 직접 비교하지 않습니다. 질문에 가까운 <개념·지표·연구질문>을 먼저 찾고, 거기서 관계를 타고 통계와 통계표에 도달합니다.",
      bullets: [
        "\"빚\" → 용어 <가계부채> → 그 용어를 정의하는 통계 → 그 통계의 통계표",
        "도달한 경로를 그대로 화면에 보여 줍니다. 왜 이 통계가 나왔는지 사용자가 검증할 수 있습니다",
        "경로가 근거이므로, 결과를 못 믿겠으면 관계 하나를 짚어 반박할 수 있습니다",
      ],
      note: "블랙박스 추천이 아니라 <따라갈 수 있는 근거>를 내놓는 것이 이 구조의 목적입니다.",
    },

    {
      key: "ontology",
      kicker: "03 온톨로지",
      title: "국제표준에 맞춰 세운 통계 지식그래프",
      lead: "임의로 만든 스키마가 아닙니다. 공공데이터 카탈로그·용어체계·통계큐브의 국제표준에 각각 대응시켰습니다.",
      stats: [
        { value: nf(c.classes), label: "클래스", note: "통계 · 통계표 · 용어 · 지표 · 생애단계 …" },
        { value: nf(c.properties), label: "관계 유형", note: "definesConcept · hasDistribution …" },
        { value: nf(c.entities), label: "노드" },
        { value: nf(c.relations), label: "관계" },
      ],
      bullets: [
        "DCAT 3 — 통계를 Dataset, 통계표를 Distribution 으로",
        "SKOS — 통계용어를 Concept 으로, 동의어·상하위어까지",
        "RDF Data Cube · SDMX — 통계표의 분류축과 측정항목을",
      ],
      note: "표준에 맞췄기 때문에 다른 기관 카탈로그와 나중에 이어붙일 수 있습니다.",
    },

    {
      key: "pipeline",
      kicker: "04 검색",
      title: "질문 한 줄이 통계표ID가 되기까지",
      flow: [
        { step: "슬롯 해석", detail: "\"35세 대전 남성\" 에서 나이·성별·지역을 뽑아 연령구간·지역코드·생애단계로 옮깁니다" },
        { step: "하이브리드 검색", detail: "임베딩 벡터 유사도와 어휘 유사도를 따로 매긴 뒤 RRF 로 합칩니다. 벡터는 뜻을, 어휘는 고유명사를 잡습니다" },
        { step: "그래프 확장", detail: "찾아낸 씨앗 노드에서 1~2홉을 걸어 통계에 도달합니다. 한 통계가 목록을 독식하지 않게 통계별 대표표를 먼저 채웁니다" },
        { step: "결과", detail: "참고할 통계, 섞어 쓰면 안 되는 조합, 그리고 바로 열 수 있는 통계표ID" },
      ],
      note: "어휘 검색을 끄면 \"월급 얼마\" 같은 짧은 별칭이 통째로 사라집니다. 두 축이 서로를 메웁니다.",
    },

    {
      key: "numbers",
      kicker: "05 수치",
      title: "나침반은 통계표ID까지. 숫자는 KOSIS 가 원본입니다.",
      lead: "찾은 통계표ID를 KOSIS 공유서비스 OpenAPI 로 넘겨 실제 수치를 그 자리에서 받아옵니다. 우리가 값을 복사해 두지 않습니다.",
      bullets: [
        "통계표를 체크박스로 고르고, 수록주기와 시점 수를 바꿔 다시 부릅니다",
        "표마다 수록주기가 다릅니다 — 연간 표에 월간을 요청하면 빈 결과가 되므로 표별 주기를 기본값으로 씁니다",
        "개편 전후를 하나의 시계열로 읽으면 안 되는 구간이 있어, 증감 해석에 대한 경고를 항상 붙입니다",
      ],
      note: "출처를 두고 헷갈릴 일이 없습니다. 화면의 모든 숫자는 KOSIS 원본이고, 카드 제목이 원 통계표로 연결됩니다.",
    },

    {
      key: "ai",
      kicker: "06 AI",
      title: "AI는 숫자를 말하지 않습니다.",
      lead: "생성형 AI를 어디에 쓰고 어디에 안 쓸지 선을 그었습니다. 통계는 숫자 하나가 틀리면 그 답변 전체를 못 믿게 됩니다.",
      versus: {
        leftTitle: "AI가 하는 일",
        left: [
          "어느 통계부터 어떤 순서로 볼지 안내",
          "질문의 초점에 맞춰 통계표 순서를 재정렬",
          "무엇을 조심해야 하는지 짚기",
        ],
        rightTitle: "AI가 하지 않는 일",
        right: [
          "금액·비율·인원 등 수치 언급",
          "검색 결과에 없는 통계명 언급",
          "찾을 통계표를 고르는 일 (검색이 정합니다)",
        ],
      },
      note: "재정렬은 순열인지 검사합니다. 표가 하나라도 늘거나 줄면 통째로 버리고 검색 순서를 씁니다. 사용자는 AI 정렬을 끌 수 있습니다.",
    },

    {
      key: "demo",
      kicker: "07 시연",
      title: "두 개의 질문",
      bullets: [
        "\"35세 대전 거주 남성인데 집을 사려면 빚을 얼마나 져야 할까요?\"",
        "\"50대 여성인데 은퇴하고 나면 필요한 자금이 얼마나 될까요?\"",
      ],
      lead: "둘 다 통계 이름이 한 글자도 들어 있지 않습니다. 그런데 가계금융복지조사·주택소유통계·연금통계가 근거 경로와 함께 나옵니다.",
      note: "시나리오는 회귀 검사로 고정해 두었습니다. 기대 통계·기대 통계표뿐 아니라 <나오면 안 되는 통계>도 함께 검사합니다 — 적중률만 높고 결과는 나쁜 상태를 잡기 위해서입니다.",
    },

    {
      key: "next",
      tone: "cover",
      kicker: "08 다음",
      title: "여기까지, 그리고 남은 것",
      bullets: [
        "MCP 서버로 검색 도구를 열어 다른 AI 에이전트가 이 그래프를 쓰게 하기",
        "온톨로지 용어층 HITL 검토 — 혼동개념·연관개념을 사람이 계속 채워 넣는 구조",
        "기관 간 카탈로그 연계 — 표준에 맞춰 세웠으므로 이어붙일 수 있습니다",
      ],
      note: "감사합니다.",
    },
  ];
}
