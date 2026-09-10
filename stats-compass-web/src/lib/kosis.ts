import "server-only";
import type { KosisDim, KosisPoint, KosisSeries } from "@/lib/kosis-types";

export type { KosisDim, KosisPoint, KosisSeries };

/**
 * KOSIS 공유서비스 호출. 개발가이드 2.2(통계자료) · 2.5(메타자료) 기준입니다.
 *
 * 나침반은 통계표ID까지만 찾습니다. 숫자는 여기서 KOSIS 로 받아옵니다.
 * 키는 서버에만 둡니다 (NEXT_PUBLIC_ 접두사 금지).
 *
 * ── 왜 메타를 먼저 읽는가
 * getList 는 `objL1` 이 필수이고, 분류 축이 둘이면 `objL2` 까지 필수입니다.
 * 축 수는 표마다 다릅니다. objL1 만 보내면 이렇게 죽습니다.
 *
 *     DT_1B85009 — 필수요청변수값이 누락되었습니다. (objL)
 *
 * DT_1B85009 는 축이 둘(시도별 A, 연령별 B)이었습니다.
 * 그래서 getMeta(type=ITM) 로 축 구성을 먼저 읽고 objL1..objLn 을 만들어 넣습니다.
 *
 * ── 왜 "계" 코드를 골라 넣는가
 * 모든 축에 ALL 을 넣으면 18(시도) × 14(연령) × 2(항목) = 504셀이 시점마다 옵니다.
 * 대시보드가 아니라 원자료 덤프가 됩니다. 축마다 "계·전체·전국" 코드를 찾아
 * 그것만 넣습니다. 없는 축만 ALL 로 두고 뒤에서 골라냅니다.
 * 무엇을 골랐는지는 화면에 그대로 적습니다. 감추면 오해를 부릅니다.
 */

/**
 * 엔드포인트가 둘입니다. 섞으면 안 됩니다.
 *
 *  META_URL  메타자료(getMeta type=ITM/PRD/TBL …). 개발가이드 2.5.
 *
 *  PARAM_URL 통계표를 직접 지정해 수치를 받는 곳. orgId·tblId·objL·itmId 를 받습니다.
 *
 * ⚠ META_URL 에 method=getList 를 보내면 <자료등록 방식>으로 처리돼
 *   userStatsId 를 요구합니다. 그래서 이렇게 답합니다.
 *
 *     {err:"20",errMsg:"필수요청변수값이 누락되었습니다."}
 *
 *   objL 을 아무리 맞춰도 소용없습니다. 주소가 다른 것뿐입니다.
 *   반대로 PARAM_URL 은 슬롯이 모자라면 "(objL)" 이라고 콕 집어 알려줍니다.
 */
const META_URL = "https://kosis.kr/openapi/statisticsData.do";
const PARAM_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do";

/** 분류값이 "총계" 성격인지 */
const TOTAL_WORDS = [
  "계", "전체", "소계", "합계", "총계", "전국", "총계(전국)", "전 연령", "남녀전체", "평균", "total",
];

function isTotalName(v: string | undefined | null): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return TOTAL_WORDS.some((w) => s === w.toLowerCase());
}

/* ────────────────────────────────────────────────────────────────
 * 메타
 * ──────────────────────────────────────────────────────────────── */

interface MetaRow {
  OBJ_ID?: string;
  OBJ_NM?: string;
  ITM_ID?: string;
  ITM_NM?: string;
  UNIT_NM?: string;
}

interface PrdRow {
  PRD_SE?: string;
  PRD_DE?: string;
}

export interface TableMeta {
  /** 분류 축. 배열 순서가 곧 objL1, objL2 … 입니다 */
  dims: Array<{ objId: string; name: string; values: Array<{ id: string; name: string }> }>;
  items: Array<{ id: string; name: string; unit: string | null }>;
  /** 이 표가 수록하는 주기들 */
  prdSe: string[];
  error: string | null;
}

/** 메타는 잘 안 바뀝니다. 같은 표를 여러 번 부르지 않도록 한 시간 캐시합니다. */
const metaCache = new Map<string, { at: number; meta: TableMeta }>();
const META_TTL = 60 * 60 * 1000;

/**
 * KOSIS 수록정보의 PRD_SE 는 <한글>로 옵니다.
 *
 *   [{ "PRD_SE": "년", "STRT_PRD_DE": "2016", "END_PRD_DE": "2024" }]
 *
 * 그런데 getList 의 prdSe 파라미터는 <코드>를 받습니다. 이 변환을 빠뜨리면
 * "Y 주기 자료가 없습니다" 같은 엉뚱한 결과가 나옵니다.
 * (같은 표가 src/seed/05_fetchPeriods.ts 에도 있습니다 — DB 적재용)
 */
const PRD_CODE: Record<string, string> = {
  년: "Y", 연: "Y", 연간: "Y", Y: "Y",
  반기: "H", H: "H", S: "H",
  분기: "Q", Q: "Q",
  월: "M", 월간: "M", M: "M",
  일: "D", D: "D",
  "2년": "F", "3년": "F", "5년": "F", 다년: "F", F: "F",
  부정기: "IR", IR: "IR",
};

function toPrdCode(raw: string): string | null {
  const s = raw.trim();
  return PRD_CODE[s] ?? PRD_CODE[s.toUpperCase()] ?? null;
}

function apiKey(): string | null {
  return process.env.KOSIS_API_KEY ?? null;
}

/**
 * KOSIS 응답을 읽습니다.
 *
 * ⚠ 오류 응답은 정상 JSON 이 아닙니다. 키에 따옴표가 없는 형태로 옵니다.
 *
 *     {err:"30",errMsg:"인증키가 유효하지 않습니다."}
 *
 * res.json() 을 그대로 쓰면 여기서 SyntaxError 가 나고, 정작 KOSIS 가 알려준
 * 원인 메시지는 사라집니다. 그래서 text 로 받아 직접 다룹니다.
 */
/** 진단용. 인증키만 가리고 나머지는 그대로 보여 줍니다. */
function masked(base: string, params: Record<string, string>): string {
  const p = new URLSearchParams({ ...params, apiKey: "***" });
  return `${base}?${p.toString()}`;
}

async function getJson(base: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`KOSIS 응답 ${res.status}`);

  const text = (await res.text()).trim();
  try {
    return JSON.parse(text);
  } catch {
    // 따옴표 없는 키를 감싸서 한 번 더 시도합니다.
    try {
      const repaired = text.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
      return JSON.parse(repaired);
    } catch {
      // 그래도 안 되면 원문을 그대로 넘겨 화면에 보이게 합니다. 감추면 원인을 못 찾습니다.
      return { __raw: text.slice(0, 300) };
    }
  }
}

/** { err, errMsg } 형태의 오류 응답인지 */
function errOf(raw: unknown): string | null {
  if (Array.isArray(raw)) return null;
  const o = (raw ?? {}) as { errMsg?: string; err?: string; __raw?: string };
  if (o.errMsg) return `KOSIS: ${o.errMsg}${o.err ? ` (${o.err})` : ""}`;
  if (o.err) return `KOSIS 오류코드 ${o.err}`;
  if (o.__raw) return `KOSIS 응답을 해석하지 못했습니다: ${o.__raw}`;
  return "KOSIS 응답 형식이 예상과 다릅니다";
}

/**
 * 통계표 구조를 읽습니다.
 *
 * `withPrd` 가 false 면 수록정보(type=PRD) 호출을 건너뜁니다.
 * 주기를 DB(statistic_tables.prd_se)에서 이미 알고 있으면 부를 이유가 없습니다.
 * 표당 호출이 3회에서 2회로 줄어듭니다.
 */
export async function getTableMeta(
  orgId: string,
  tblId: string,
  withPrd = true,
): Promise<TableMeta> {
  const key = apiKey();
  const empty: TableMeta = { dims: [], items: [], prdSe: [], error: null };
  if (!key) {
    return { ...empty, error: "KOSIS_API_KEY 가 없습니다. stats-compass-web/.env.local 에 넣으세요." };
  }

  const ck = `${orgId}-${tblId}`;
  const hit = metaCache.get(ck);
  if (hit && Date.now() - hit.at < META_TTL && (!withPrd || hit.meta.prdSe.length > 0)) {
    return hit.meta;
  }

  try {
    const [itmRaw, prdRaw] = await Promise.all([
      getJson(META_URL, { method: "getMeta", type: "ITM", apiKey: key, orgId, tblId, format: "json", jsonVD: "Y" }),
      withPrd
        ? getJson(META_URL, { method: "getMeta", type: "PRD", apiKey: key, orgId, tblId, format: "json", jsonVD: "Y" })
        : Promise.resolve([]),
    ]);

    const e = errOf(itmRaw);
    if (e) return { ...empty, error: `분류 메타(getMeta type=ITM) — ${e}` };

    // OBJ_ID 가 'ITEM' 인 행은 항목(itmId), 나머지는 분류 축입니다.
    // 축의 순서(objL1, objL2 …)는 응답에 나온 순서를 따릅니다. 별도 순번 필드가 없습니다.
    const dimOrder: string[] = [];
    const dimMap = new Map<string, { objId: string; name: string; values: Array<{ id: string; name: string }> }>();
    const items: TableMeta["items"] = [];

    for (const r of itmRaw as MetaRow[]) {
      const objId = String(r.OBJ_ID ?? "");
      const id = String(r.ITM_ID ?? "");
      const name = String(r.ITM_NM ?? "");
      if (!objId || !id) continue;

      if (objId.toUpperCase() === "ITEM") {
        items.push({ id, name, unit: r.UNIT_NM ?? null });
        continue;
      }
      let d = dimMap.get(objId);
      if (!d) {
        d = { objId, name: String(r.OBJ_NM ?? objId), values: [] };
        dimMap.set(objId, d);
        dimOrder.push(objId);
      }
      d.values.push({ id, name });
    }

    // PRD_SE 는 한글("년")로 오므로 코드("Y")로 바꿔 둡니다.
    const prdSe = Array.isArray(prdRaw)
      ? [
          ...new Set(
            (prdRaw as PrdRow[])
              .map((r) => toPrdCode(String(r.PRD_SE ?? "")))
              .filter((v): v is string => v !== null),
          ),
        ]
      : [];

    const meta: TableMeta = {
      dims: dimOrder.map((k) => dimMap.get(k)!),
      items,
      prdSe,
      error: null,
    };
    metaCache.set(ck, { at: Date.now(), meta });
    return meta;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ...empty, error: m.includes("timeout") ? "KOSIS 메타 응답이 12초를 넘겼습니다" : m };
  }
}

/* ────────────────────────────────────────────────────────────────
 * 자료
 * ──────────────────────────────────────────────────────────────── */

interface DataRow {
  PRD_DE?: string;
  DT?: string;
  UNIT_NM?: string;
  TBL_NM?: string;
  ITM_ID?: string;
  ITM_NM?: string;
  C1?: string;
  C2?: string;
  C3?: string;
  C4?: string;
  C5?: string;
  C6?: string;
  C7?: string;
  C8?: string;
  C1_NM?: string;
  C2_NM?: string;
  C3_NM?: string;
  C4_NM?: string;
  C5_NM?: string;
  C6_NM?: string;
  C7_NM?: string;
  C8_NM?: string;
}

export interface FetchOpts {
  orgId: string;
  tblId: string;
  /**
   * 쓰고 싶은 주기. 비우면 knownPrdSe → 수록정보 순으로 정합니다.
   * Y=연 H=반기 Q=분기 M=월
   */
  prdSe?: string | null;
  /**
   * DB(statistic_tables.prd_se)가 아는 이 표의 주기.
   * 있으면 수록정보 조회를 건너뛰어 호출을 아낍니다.
   */
  knownPrdSe?: string | null;
  /** 최근 N개 시점 */
  count?: number;
}

/**
 * 계열 식별자. <코드>로 묶습니다.
 *
 * 이름으로 묶으면 이름이 같고 코드가 다른 행들이 한 덩어리가 됩니다.
 * 실제로 DT_1LC0036 에서 2020년이 세 번 나오고 값이 다 달랐습니다.
 * 한 계열의 한 시점에는 값이 하나여야 합니다.
 */
function keyOf(r: DataRow): string {
  return [r.C1, r.C2, r.C3, r.C4, r.C5, r.C6, r.C7, r.C8, r.ITM_ID].map((v) => v ?? "").join("|");
}

/** 화면에 보여 줄 계열 이름 */
function labelOf(r: DataRow): string {
  return [r.C1_NM, r.C2_NM, r.C3_NM, r.C4_NM, r.C5_NM, r.C6_NM, r.C7_NM, r.C8_NM, r.ITM_NM]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 비율·구성비 성격의 항목인지.
 *
 * "총계에 가까운 것" 만 보고 고르면 구성비 합계를 집습니다. 그 값은 언제나 100 이라
 * 대시보드에 100% 만 뜹니다. 실제로 이렇게 나왔습니다.
 *
 *   생활비 마련 방법 — 60세이상 가구원 … 100%
 *   가구주연령계층별 자산·부채·소득 … 100만원
 *
 * 같은 표에 인구수·가구수 같은 실수치 항목이 있으면 그쪽을 씁니다.
 */
const RATIO_WORDS = ["구성비", "비중", "비율", "분포", "백분율", "구성", "%"];
function isRatio(name: string | undefined, unit: string | undefined): boolean {
  const n = (name ?? "").trim();
  const u = (unit ?? "").trim();
  if (u === "%" || u === "％") return true;
  return RATIO_WORDS.some((w) => n.includes(w));
}

/**
 * 대표 계열 점수. 높을수록 먼저입니다.
 *
 *   분류축이 "계·전체" 일수록  +2 씩   — 총계를 보고 싶으니까
 *   항목이 비율·구성비면        -3      — 언제나 100 이라 볼 게 없으니까
 *   항목이 "계" 면              +1
 */
function dimValues(r: DataRow): Array<string | undefined> {
  return [r.C1_NM, r.C2_NM, r.C3_NM, r.C4_NM, r.C5_NM, r.C6_NM, r.C7_NM, r.C8_NM];
}

function totalScore(r: DataRow): number {
  let s = 0;
  for (const v of dimValues(r)) {
    if (v === undefined) continue;
    if (isTotalName(v)) s += 2;
    // 비율은 항목이 아니라 <분류값>에 들어 있기도 합니다.
    //   "전체 · 전체 · 가구분포 · 전가구 평균"  ← C3 가 가구분포
    // 항목만 보면 이걸 놓쳐 100 만 뜹니다.
    if (isRatio(v, undefined)) s -= 3;
  }
  if (isTotalName(r.ITM_NM)) s += 1;
  if (isRatio(r.ITM_NM, r.UNIT_NM)) s -= 3;
  return s;
}

export async function fetchKosisSeries(opts: FetchOpts): Promise<KosisSeries> {
  // 우선순위: 사용자가 고른 주기 → DB 가 아는 이 표의 주기 → 연간
  const wantPrd = opts.prdSe ?? opts.knownPrdSe ?? "Y";
  // 사용자가 특정 주기를 고르지 않았고 DB 가 주기를 알면 수록정보를 안 부릅니다.
  const needPrdMeta = !(opts.prdSe == null && opts.knownPrdSe != null);
  const base: KosisSeries = {
    orgId: opts.orgId,
    tblId: opts.tblId,
    tableName: null,
    seriesName: "",
    unit: null,
    points: [],
    seriesTotal: 0,
    seriesNote: null,
    isDuration: false,
    dims: [],
    prdSeUsed: wantPrd,
    availablePrd: [],
    error: null,
  };

  const key = apiKey();
  if (!key) {
    return { ...base, error: "KOSIS_API_KEY 가 없습니다. stats-compass-web/.env.local 에 넣으세요." };
  }

  /* ① 구조를 먼저 읽습니다 — objL 슬롯이 몇 개인지 알아야 호출이 됩니다. */
  const meta = await getTableMeta(opts.orgId, opts.tblId, needPrdMeta);

  /* ② 축마다 넣을 값을 고릅니다 — "계" 가 있으면 그것, 없으면 ALL.
   *
   * 메타를 못 읽었어도 포기하지 않습니다. 아래에서 objL 슬롯을 1개부터 늘려가며
   * 재시도하면 축 수를 몰라도 결국 맞는 조합을 찾습니다. 메타는 "계" 코드를
   * 골라 응답을 작게 만드는 최적화지, 없으면 안 되는 것이 아닙니다. */
  const dims: KosisDim[] = meta.dims.map((d, i) => {
    const total = d.values.find((v) => isTotalName(v.name));
    return {
      slot: i + 1,
      objId: d.objId,
      name: d.name,
      chosen: total ? total.id : "all",
      chosenName: total ? total.name : "전체 분류",
    };
  });

  /* ③ 주기. 이 표가 수록하지 않는 주기를 부르면 빈 결과가 옵니다. */
  const availablePrd =
    meta.prdSe.length > 0 ? meta.prdSe : opts.knownPrdSe ? [opts.knownPrdSe] : [];
  const prdSe =
    availablePrd.length === 0 || availablePrd.includes(wantPrd) ? wantPrd : availablePrd[0];

  const baseParams: Record<string, string> = {
    method: "getList",
    apiKey: key,
    format: "json",
    jsonVD: "Y",
    orgId: opts.orgId,
    tblId: opts.tblId,
    // 개발가이드 2.2.2.1: "항목과 분류별 전체선택시 'all'" — 소문자입니다.
    itmId: "all",
    prdSe,
    newEstPrdCnt: String(opts.count ?? 5),
  };

  /**
   * objL 슬롯 조합 후보.
   *
   * 메타를 읽었으면 축 수가 정확하므로 한 번에 끝납니다.
   * 못 읽었으면 objL1 부터 objL4 까지 늘려가며 시도합니다. KOSIS 는 슬롯이
   * 모자라면 "필수요청변수값이 누락되었습니다(objL)" 로 답하므로, 그 응답을
   * 신호 삼아 하나씩 늘리면 축 수를 몰라도 맞는 조합에 도달합니다.
   */
  /* 후퇴 순서는 <좁은 쪽부터> 입니다.
   *
   * 넓히는 쪽으로만 후퇴하니 이렇게 됐습니다.
   *   축에 "계" 없음 → all,all → 4만 셀 초과(31)
   * 반대로 좁히기만 하면 축이 모자랄 때(objL 누락) 영영 못 맞춥니다. 그래서 셋을 순서대로.
   *
   *   ① 총계 코드      자료만 있으면 가장 작고 의미도 맞습니다
   *   ② 각 축의 첫 값   ①의 코드를 KOSIS 가 거부하거나(21) 자료가 없을 때(30) 쓰는 대안.
   *                    셀 수가 ①과 비슷해 31 을 안 냅니다
   *   ③ 전부 all       축 개수를 모를 때만 의미가 있습니다
   */
  const firstOf = (slot: number): string | null => meta.dims[slot - 1]?.values[0]?.id ?? null;

  const byChosen = Object.fromEntries(dims.map((d) => [`objL${d.slot}`, d.chosen]));
  const byFirst = Object.fromEntries(
    dims.map((d) => [`objL${d.slot}`, d.chosen === "all" ? (firstOf(d.slot) ?? "all") : d.chosen]),
  );
  const byFirstAlways = Object.fromEntries(
    dims.map((d) => [`objL${d.slot}`, firstOf(d.slot) ?? "all"]),
  );
  const progressive = [1, 2, 3, 4].map((n) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`objL${i + 1}`, "all"])),
  );

  const seen = new Set<string>();
  const attempts: Array<Record<string, string>> = [];
  for (const a of dims.length > 0
    ? [byChosen, byFirst, byFirstAlways, ...progressive]
    : progressive) {
    const sig = JSON.stringify(a);
    if (Object.keys(a).length === 0 || seen.has(sig)) continue;
    seen.add(sig);
    attempts.push(a);
  }

  let raw: unknown = null;
  let lastErr: string | null = null;
  let lastUrl = "";

  for (const objs of attempts) {
    const params = { ...baseParams, ...objs };
    lastUrl = masked(PARAM_URL, params);
    try {
      raw = await getJson(PARAM_URL, params);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      lastErr = m.includes("timeout") ? "KOSIS 응답이 12초를 넘겼습니다" : m;
      break;
    }
    const err = errOf(raw);
    if (err === null) {
      lastErr = null;
      break;
    }
    lastErr = err;
    /* 다음 후보로 넘어갈 만한 오류인가.
     *
     *   objL 누락  → 슬롯이 모자람. 하나 더 붙여 재시도.
     *   (30) 데이터 없음 → 제가 고른 "계" 코드에 자료가 없음.
     *                     실제로 사회조사 표에서 objL2=B01 이 그랬습니다.
     *                     다음 후보는 전부 all 이므로 이걸로 풀립니다.
     * 인증·한도 오류는 재시도해도 같은 답이 오니 즉시 멈춥니다. */
    const fatal =
      err.includes("인증키") ||
      err.includes("호출가능건수") ||
      err.includes("이용 제한") ||
      err.includes("서버");
    if (fatal) break;
  }

  if (lastErr !== null) {
    const hint = meta.error ? ` · 메타도 실패: ${meta.error}` : "";
    // 무엇을 보냈는지 함께 보여 줍니다. 이게 없으면 "누락" 이라는 말만 보고
    // 무엇이 빠졌는지 추측만 하게 됩니다. 인증키는 가려져 있습니다.
    return {
      ...base,
      dims,
      prdSeUsed: prdSe,
      availablePrd,
      error: `자료 조회(getList) — ${lastErr}${hint}\n요청: ${lastUrl}`,
    };
  }

  const rows = raw as DataRow[];
  if (rows.length === 0) {
    return {
      ...base,
      dims,
      prdSeUsed: prdSe,
      availablePrd,
      error: `${prdSe} 주기의 수록 자료가 없습니다`,
    };
  }

  /* ④ 계열별로 묶고 대표 하나를 고릅니다. */
  const groups = new Map<string, DataRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }

  /**
   * DT 를 값과 표기로 나눕니다.
   *
   * KOSIS 의 DT 가 늘 숫자는 아닙니다.
   *   "9:24"  생활시간조사의 시:분 표기 → 564분으로 환산, 표기는 "9시간 24분"
   *   "-"     자료 없음 통계부호
   *   "…"     미상 등 그 밖의 부호
   * Number() 만 쓰면 이런 값이 전부 NaN 이 되어 화면이 "—" 로 채워집니다.
   */
  const RE_HHMM = /^(\d+)\s*:\s*(\d{1,2})$/;
  let durationSeen = false;

  const parseDT = (dt: string | undefined): { value: number | null; text: string | null } => {
    const s = (dt ?? "").trim();
    if (s === "" || s === "-") return { value: null, text: null };

    const m = RE_HHMM.exec(s);
    if (m) {
      durationSeen = true;
      return { value: Number(m[1]) * 60 + Number(m[2]), text: `${m[1]}시간 ${m[2]}분` };
    }

    const n = Number(s.replace(/,/g, ""));
    if (Number.isFinite(n)) return { value: n, text: null };
    // 숫자도 시:분도 아니면 통계부호입니다. 그대로 보여 줍니다.
    return { value: null, text: s };
  };

  const toPoints = (g: DataRow[]): KosisPoint[] =>
    g
      .map((r) => ({ period: String(r.PRD_DE ?? ""), ...parseDT(r.DT) }))
      .filter((p) => p.period !== "")
      .sort((a, b) => a.period.localeCompare(b.period));

  /** 최신 시점 값의 크기. 동점일 때 "가구원수 2.31" 대신 "자산 56,678" 을 고르게 합니다. */
  const magnitude = (g: DataRow[]): number => {
    const v = toPoints(g).at(-1)?.value;
    return v === null || v === undefined ? -1 : Math.abs(v);
  };

  // 순서: ① 총계에 가까운가 ② 시점이 많은가 ③ 값이 큰가
  // ③ 이 필요한 이유 — 축에 "계" 가 없는 표에서는 ①②가 다 같아 사실상 아무거나
  // 집게 됩니다. 그럴 때 자산·소득 같은 본 수치가 가구원수 같은 부수 항목보다
  // 크다는 점을 이용합니다. 완벽한 규칙은 아니지만 훨씬 자주 맞습니다.
  let bestKey = "";
  let bestRank: [number, number, number] = [-1, -1, -1];
  for (const [k, g] of groups) {
    const rank: [number, number, number] = [totalScore(g[0]), g.length, magnitude(g)];
    const better =
      rank[0] > bestRank[0] ||
      (rank[0] === bestRank[0] &&
        (rank[1] > bestRank[1] || (rank[1] === bestRank[1] && rank[2] > bestRank[2])));
    if (better) {
      bestRank = rank;
      bestKey = k;
    }
  }

  /* 총계가 늘 100 인 계열은 볼 게 없습니다.
   *
   * 구성비 표에서 "합계" 를 고르면 2005년 100%, 2007년 100% 만 나옵니다.
   * 이런 표의 알맹이는 총계가 아니라 <어느 항목이 큰가> 입니다.
   * 그래서 값이 전부 100 이면 가장 큰 항목으로 바꿔 고르고, 바꿨다는 사실을 적습니다. */
  let seriesNote: string | null = null;
  const allHundred = (g: DataRow[]) => {
    const vs = toPoints(g).map((p) => p.value);
    return vs.length > 0 && vs.every((v) => v !== null && Math.abs(v - 100) < 0.0001);
  };

  /* 계열 식별자는 "C1|C2|…|ITM_ID" 입니다. 마지막 조각만 항목이고 앞은 분류입니다. */
  const clsOf = (k: string) => k.slice(0, k.lastIndexOf('|'));

  if (bestKey !== "" && groups.size > 1 && allHundred(groups.get(bestKey)!)) {
    /* 100 을 쪼개는 축은 <항목>입니다.
     *
     *   부모와의 교류: 거의 매일 20.0 · 일주일에 한두번 44.4 · 한달에 한두번 29.0
     *
     * 그래서 분류(행정구역·성별·연령)는 그대로 두고 항목만 바꿔야 합니다.
     * 값이 큰 계열을 아무거나 고르면 "전국 → 동부" 처럼 분류를 갈아타는데,
     * 동부의 계도 100 이라 아무것도 나아지지 않습니다. 실제로 그렇게 나왔습니다.
     */
    const wantCls = clsOf(bestKey);
    const pick = (sameCls: boolean): string => {
      let key = "";
      let max = -Infinity;
      for (const [k, g] of groups) {
        if (k === bestKey) continue;
        if (sameCls && clsOf(k) !== wantCls) continue;
        const last = toPoints(g).at(-1)?.value;
        if (last === null || last === undefined) continue;
        // 대체한 계열까지 100 이면 고를 이유가 없습니다.
        if (Math.abs(last - 100) < 0.0001) continue;
        if (last > max) {
          max = last;
          key = k;
        }
      }
      return key;
    };

    // ① 같은 분류 안에서 항목만 바꿔 봅니다  ② 없으면 아무 계열
    const altKey = pick(true) || pick(false);
    if (altKey !== "") {
      const was = labelOf(groups.get(bestKey)![0]);
      const now = labelOf(groups.get(altKey)![0]);
      seriesNote = `총계가 항상 100이라 가장 큰 항목으로 바꿨습니다 — ${now} (원래: ${was})`;
      bestKey = altKey;
    }
  }

  const picked = groups.get(bestKey) ?? [];

  /* "계" 코드가 없어 all 로 부른 축은, 실제로 고른 값이 무엇인지 되짚어 채웁니다.
   * 그냥 "전체 분류" 라고 두면 화면에는 <주택유형별=전체 분류> 라고 적히는데
   * 실제 계열은 <아파트> 여서 서로 어긋납니다. 그런 표시는 없느니만 못합니다. */
  const first = picked[0] as Record<string, unknown> | undefined;
  for (const d of dims) {
    if (d.chosen !== "all") continue;
    const actual = first?.[`C${d.slot}_NM`];
    d.chosenName = typeof actual === "string" && actual !== "" ? `${actual}(자동 선택)` : "전체 분류";
  }
  const points: KosisPoint[] = toPoints(picked);

  return {
    orgId: opts.orgId,
    tblId: opts.tblId,
    tableName: picked[0]?.TBL_NM ?? null,
    seriesName: picked[0] ? labelOf(picked[0]) : "(분류 없음)",
    unit: picked[0]?.UNIT_NM ?? meta.items[0]?.unit ?? null,
    points,
    seriesTotal: groups.size,
    seriesNote,
    isDuration: durationSeen,
    dims,
    prdSeUsed: prdSe,
    availablePrd,
    error: points.length === 0 ? "값이 비어 있습니다" : null,
  };
}

/**
 * 여러 표를 동시에.
 *
 * 표 하나당 호출이 최대 3회(메타 ITM·PRD + 자료)입니다. KOSIS 는 분당 200회 제한이 있어
 * 동시 3건으로 묶습니다. 메타는 캐시되므로 같은 표를 다시 부를 땐 1회로 줄어듭니다.
 */
export async function fetchMany(items: FetchOpts[], limit = 3): Promise<KosisSeries[]> {
  const out: KosisSeries[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fetchKosisSeries(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
