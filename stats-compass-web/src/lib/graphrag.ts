/** GraphRAG 검색 결과 타입. 클라이언트에서도 씁니다. */

export interface RagPath {
  /** 어떤 노드에서 출발했는지 */
  from: string;
  fromClass: string;
  /** 어떤 관계를 타고 왔는지. null 이면 그 노드 자체가 검색에 걸린 것 */
  via: string | null;
  sim: number;
  why: string | null;
}

export interface RagSurvey {
  id: string;
  label: string;
  statId: string | null;
  overview: string | null;
  score: number;
  paths: RagPath[];
}

export interface RagTable {
  label: string;
  orgId: string | null;
  tblId: string | null;
  latestPeriod: string | null;
  /** 수록 시작시점. latestPeriod 와 짝을 이뤄 "2016~2024" 로 보여 줍니다 */
  firstPeriod: string | null;
  /** 수록 주기 코드 (Y/H/Q/M/D/F/IR). 이 표를 KOSIS 에서 부를 때 쓸 주기입니다 */
  prdSe: string | null;
  survey: string | null;
  score: number;
  /** 그 조사 안에서 몇 번째로 가까운 표인지. 1이면 그 조사의 대표표, 0이면 질의 직접 적중입니다. */
  rank: number;
  /** 질의에 직접 걸린 표인가. 조사를 거쳐 고른 표와 구분합니다 */
  directHit: boolean;
}

export interface RagCaution {
  a: string;
  b: string;
  why: string | null;
}

export interface RagSeed {
  label: string;
  class: string;
  sim: number;
}

/** 후보까지 갔다가 밀린 조사. 그래프에서 흐리게 그립니다. */
export interface RagDropped {
  label: string;
  score: number;
  /** 채택된 조사 중 이것과 혼동쌍으로 묶인 것. 탈락 <원인>은 아니고 참고 사항입니다 */
  confusedWith: string | null;
}

export interface RagConcept {
  label: string;
  definition: string | null;
  /** 이 용어를 정의하는 조사들 — 조사 사이를 잇는 다리가 됩니다 */
  surveys: string[];
}

export interface RagResult {
  seeds: RagSeed[];
  surveys: RagSurvey[];
  dropped: RagDropped[];
  concepts: RagConcept[];
  tables: RagTable[];
  cautions: RagCaution[];
}

export const EMPTY_RAG: RagResult = {
  seeds: [],
  surveys: [],
  dropped: [],
  concepts: [],
  tables: [],
  cautions: [],
};

const s = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const sn = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

export function toRagResult(value: unknown): RagResult {
  if (!value || typeof value !== "object") return EMPTY_RAG;
  const raw = value as Record<string, unknown>;

  return {
    seeds: arr(raw.seeds).map((x) => ({ label: s(x.label), class: s(x.class), sim: n(x.sim) })),
    surveys: arr(raw.surveys)
      .map((x) => ({
        id: s(x.id),
        label: s(x.label),
        statId: sn(x.statId),
        overview: sn(x.overview),
        score: n(x.score),
        paths: arr(x.paths).map((p) => ({
          from: s(p.from),
          fromClass: s(p.fromClass),
          via: sn(p.via),
          sim: n(p.sim),
          why: sn(p.why),
        })),
      }))
      .filter((x) => x.label !== ""),
    tables: arr(raw.tables)
      .map((x) => ({
        label: s(x.label),
        orgId: sn(x.orgId),
        tblId: sn(x.tblId),
        latestPeriod: sn(x.latestPeriod),
        firstPeriod: sn(x.firstPeriod),
        prdSe: sn(x.prdSe),
        survey: sn(x.survey),
        score: n(x.score),
        rank: n(x.rank),
        directHit: x.directHit === true,
      }))
      .filter((x) => x.label !== ""),
    dropped: arr(raw.dropped)
      .map((x) => ({ label: s(x.label), score: n(x.score), confusedWith: sn(x.confusedWith) }))
      .filter((x) => x.label !== ""),
    concepts: arr(raw.concepts)
      .map((x) => ({
        label: s(x.label),
        definition: sn(x.definition),
        surveys: Array.isArray(x.surveys) ? x.surveys.map(s).filter(Boolean) : [],
      }))
      .filter((x) => x.label !== ""),
    cautions: arr(raw.cautions)
      .map((x) => ({ a: s(x.a), b: s(x.b), why: sn(x.why) }))
      .filter((x) => x.a !== "" && x.b !== ""),
  };
}

/** KOSIS 통계표 바로가기 */
export function kosisTableUrl(orgId: string | null, tblId: string | null): string | null {
  if (!orgId || !tblId) return null;
  return `https://kosis.kr/statHtml/statHtml.do?orgId=${encodeURIComponent(orgId)}&tblId=${encodeURIComponent(tblId)}`;
}
