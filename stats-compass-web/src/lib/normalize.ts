import type {
  Json,
  StatisticEventRow,
  StatisticHistoryRow,
  StatisticRow,
  TimelineItem,
} from "./types";

/** 여러 후보 키 중 처음으로 값이 있는 것을 반환 */
export function pick<T = unknown>(row: Record<string, unknown>, keys: string[]): T | null {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

const DATE_KEYS = [
  // statistic_history / statistic_events 실제 컬럼 (2026-09-09 Supabase 스키마 확인)
  "effective_from",
  "occurred_at",
  "event_date",
  "occurred_on",
  "happened_at",
  "date",
  "changed_at",
  "effective_date",
  "period",
  "year",
  "published_at",
  "created_at",
];
const TITLE_KEYS = ["title", "change_summary", "summary", "name", "event_name", "change_title", "headline"];
const DESC_KEYS = ["description", "detail", "details", "content", "body", "note", "memo"];
const TYPE_KEYS = ["event_type", "change_type", "type", "kind", "category"];
const URL_KEYS = ["source_url", "change_document_url", "url", "link", "kosis_url", "reference_url"];

export function toTimelineItem(row: StatisticHistoryRow | StatisticEventRow): TimelineItem {
  const r = row as Record<string, unknown>;
  const rawDate = pick<string | number>(r, DATE_KEYS);
  return {
    id: String(r.id),
    date: rawDate === null ? null : String(rawDate),
    title: pick<string>(r, TITLE_KEYS) ?? "변경 사항",
    description: pick<string>(r, DESC_KEYS),
    type: pick<string>(r, TYPE_KEYS),
    sourceUrl: pick<string>(r, URL_KEYS),
    statisticId: pick<string>(r, ["statistic_id"]),
  };
}

/** tags 컬럼이 text[] / jsonb / 콤마 문자열 어느 형태여도 string[] 로 */
export function toTags(value: StatisticRow["tags"] | Json | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    const s = value.trim();
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      } catch {
        /* fallthrough */
      }
    }
    return s
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((t) => t.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, Json>).map(String).filter(Boolean);
  }
  return [];
}

/** 정렬용: 날짜 문자열을 비교 가능한 값으로 (없으면 가장 오래된 것으로) */
export function dateSortKey(d: string | null): number {
  if (!d) return -Infinity;
  const t = Date.parse(d);
  if (!Number.isNaN(t)) return t;
  const y = parseInt(d.slice(0, 4), 10);
  return Number.isNaN(y) ? -Infinity : Date.UTC(y, 0, 1);
}

/* ------------------------------------------------------------------ */
/* raw_meta (KOSIS 통계설명자료) 처리                                     */
/* ------------------------------------------------------------------ */

/**
 * KOSIS 메타 값에는 HTML 엔티티가 이중 이스케이프되어 들어옵니다.
 * 예) '&amp;times;' -> 1차 디코드 '&times;' -> 2차 디코드 '×'
 */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  times: "×",
  sim: "~",
  middot: "·",
  deg: "°",
  plusmn: "±",
  minus: "-",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rarr: "→",
  larr: "←",
  sup2: "²",
  sup3: "³",
  frac12: "½",
};

function decodeOnce(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) => ENTITIES[name] ?? m);
}

export function decodeEntities(s: string): string {
  return decodeOnce(decodeOnce(s));
}

/** '해당없음', '없음', '-' 처럼 사실상 빈 값인 표기 */
const PLACEHOLDERS = new Set([
  "-",
  "--",
  "없음",
  "해당없음",
  "해당 없음",
  "해당사항없음",
  "해당사항 없음",
  "미해당",
  "n/a",
  "na",
]);

/** 엔티티 디코드 + 공백 정리. 빈 값·플레이스홀더는 빈 문자열로 */
export function cleanMetaText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = decodeEntities(String(value)).replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (PLACEHOLDERS.has(s.toLowerCase())) return "";
  return s;
}

/** raw_meta 를 안전하게 Record 로 */
function asRecord(raw: Json | null | undefined): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** raw_meta 에서 후보 키 중 첫 유효값을 정리해서 반환 */
export function metaValue(raw: Json | null | undefined, keys: string[]): string | null {
  const r = asRecord(raw);
  if (!r) return null;
  for (const k of keys) {
    const v = cleanMetaText(r[k]);
    if (v) return v;
  }
  return null;
}

/** 'YYYYMMDD' -> '2018-08-23' (그 외 형식은 그대로) */
export function kosisDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

/**
 * 사이드바에 짧게 노출할 메타 항목.
 * 본문·기본정보 카드에서 이미 보여주는 항목(작성기관·주기·목적·법적근거·조사대상·
 * 작성방법·연혁·용어·유의사항)은 중복이므로 제외했습니다.
 */
const SHORT_META: Array<[string, string]> = [
  ["statsField", "통계 분야"],
  ["statsKind", "통계 종류"],
  ["statsEnd", "통계 구분"],
  ["statsContinue", "계속 여부"],
  ["examinObjArea", "조사 지역"],
  ["statsPeriod", "작성 주기"],
  ["pubPeriod", "공표 주기"],
  ["pubDate", "공표 시기"],
  ["pubExtent", "공표 범위"],
  ["applyGroup", "적용 집단"],
];

/**
 * 본문 '조사 설계' 섹션에 길게 노출할 메타 항목.
 * 값이 길어 사이드바에는 맞지 않는 것들입니다.
 */
const LONG_META: Array<[string, string]> = [
  ["josaUnit", "조사 단위"],
  ["josaItm", "조사 항목"],
  ["examinTrgetPd", "조사 대상 기간"],
  ["examinPd", "조사 기간"],
  ["writingSystem", "작성 체계"],
  ["publictMth", "공표 방법"],
  ["sampleFrame", "표본 추출틀"],
  ["extrUnit", "추출 단위"],
  ["sampleSclCfml", "표본 규모"],
  ["sampleAprtMthd", "표본 배분"],
  ["sampleExtrMthd", "표본 추출 방법"],
  ["estEqua", "추정식"],
  ["wgtAjmt", "가중치 조정"],
  ["nonresratenonresAct", "무응답 대처"],
  ["enumSampleMng", "표본 관리"],
  ["exmnrScl", "조사원 규모"],
  ["exmnrEduTrng", "조사원 교육"],
  ["grndsExmnGuid", "실사 지도"],
  ["exmnTaskFlow", "업무 흐름"],
  ["outIdntfProc", "이상치 처리"],
  ["totData", "통계 이용 시 참고"],
  ["etcRefData", "기타 참고자료"],
  ["pldoc", "관련 지침서"],
];

function entriesFrom(
  raw: Json | null | undefined,
  spec: Array<[string, string]>,
  limit: number,
): Array<[string, string]> {
  const r = asRecord(raw);
  if (!r) return [];
  const out: Array<[string, string]> = [];
  for (const [key, label] of spec) {
    const v = cleanMetaText(r[key]);
    if (!v) continue;
    out.push([label, v]);
    if (out.length >= limit) break;
  }
  return out;
}

/** 사이드바용 짧은 KOSIS 메타 목록 */
export function metaEntries(raw: Json | null | undefined, limit = 12): Array<[string, string]> {
  return entriesFrom(raw, SHORT_META, limit);
}

/** 본문 '조사 설계'용 긴 KOSIS 메타 목록 */
export function metaDetailEntries(raw: Json | null | undefined, limit = 24): Array<[string, string]> {
  return entriesFrom(raw, LONG_META, limit);
}

/* ------------------------------------------------------------------ */
/* 긴 설명 텍스트 -> 문단 분리                                            */
/* ------------------------------------------------------------------ */

/** 글머리 기호 앞에서 줄을 나눠 읽기 쉬운 문단 배열로 */
export function toParagraphs(text: string | null | undefined): string[] {
  const s = cleanMetaText(text);
  if (!s) return [];
  return s
    .replace(/\s*([ㅇ○●□■◇◆▷▶])\s*/g, "\n$1 ")
    .replace(/\s*(?=[①-⑳])/g, "\n")
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
}

/* ------------------------------------------------------------------ */
/* examinHistory(조사 연혁) -> 타임라인                                   */
/* ------------------------------------------------------------------ */

const BULLET = /[ㅇ○●□■◇◆▷▶]/;
/** '(2017년)', '1948년', '1990. 12.' 처럼 연도로 시작하는 구간 */
const YEAR_LEAD = /(?:^|\s)(?=\(?(?:19|20)\d{2}\)?\s*[년.,)])/g;

function yearOf(segment: string): string | null {
  const m = segment.match(/(?:19|20)\d{2}/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  return y >= 1900 && y <= 2100 ? String(y) : null;
}

/**
 * KOSIS `examinHistory` 문자열을 타임라인 항목으로 파싱합니다.
 *
 * 표기가 기관마다 제각각(글머리 'ㅇ'/'○', 연도 선두, 줄글)이라 두 단계로 처리합니다.
 * 1) 글머리 기호가 있으면 그것으로 분리
 * 2) 없으면 연도 앞에서 분리
 * 두 방법 모두 2개 미만으로 쪼개지면 타임라인 대신 줄글로 보여주도록 빈 배열을 반환합니다.
 */
export function parseExaminHistory(text: string | null | undefined): TimelineItem[] {
  const s = cleanMetaText(text);
  if (!s || s.length < 10) return [];

  let segments: string[] = [];
  if (BULLET.test(s)) {
    segments = s.split(new RegExp(`\\s*${BULLET.source}\\s*`, "g"));
  }
  segments = segments.map((x) => x.trim()).filter((x) => x.length > 3);

  // 글머리로 나눠지지 않으면 연도 기준으로 재시도
  if (segments.length < 2) {
    segments = s
      .split(YEAR_LEAD)
      .map((x) => x.trim())
      .filter((x) => x.length > 3);
  }
  if (segments.length < 2) return [];

  // '주요연혁' 같은 머리말 조각은 버립니다 (연도가 없고 너무 짧은 것)
  const meaningful = segments.filter((seg) => yearOf(seg) !== null || seg.length >= 12);
  if (meaningful.length < 2) return [];

  return meaningful.map((raw, i) => {
    let seg = raw.replace(/^[-\s]+/, "").replace(/[-\s]+$/, "");
    const year = yearOf(seg);
    // 날짜 배지와 중복되는 선두 연도 표기를 제거 ('1948년 ...', '(2017년) ...')
    if (year) {
      const stripped = seg.replace(new RegExp(`^\\(?${year}\\)?년?\\)?\\s*[.:\\-]?\\s*`), "");
      if (stripped.length > 4) seg = stripped;
    }
    // 첫 문장에서 끊되, '2018. 10.' 같은 날짜 표기 중간에서는 끊지 않습니다
    const cut = seg.search(/[.。](?=\s+[^\d\s])/);
    const hasSplit = cut > 14 && seg.length - cut > 20;
    return {
      id: `meta-history-${i}`,
      date: year,
      title: hasSplit ? seg.slice(0, cut + 1).trim() : seg,
      description: hasSplit ? seg.slice(cut + 1).trim() : null,
      type: null,
      sourceUrl: null,
      statisticId: null,
    } satisfies TimelineItem;
  });
}

/* ------------------------------------------------------------------ */
/* AI 정제 콘텐츠                                                        */
/* ------------------------------------------------------------------ */

/** statistics.ai_content 를 안전하게 읽습니다. 값이 없거나 형태가 다르면 빈 객체 */
export function toAiContent(value: unknown): {
  summary: string | null;
  overview: string | null;
  terms: Array<{ term: string; plain: string }>;
  cautions: string[];
  sources: Array<{ title: string; url: string }>;
} {
  const empty = { summary: null, overview: null, terms: [], cautions: [], sources: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  return {
    summary: str(v.summary),
    overview: str(v.overview),
    terms: Array.isArray(v.terms)
      ? (v.terms as unknown[])
          .map((t) => t as Record<string, unknown>)
          .filter((t) => str(t?.term) && str(t?.plain))
          .map((t) => ({ term: String(t.term).trim(), plain: String(t.plain).trim() }))
      : [],
    cautions: Array.isArray(v.cautions)
      ? (v.cautions as unknown[]).map((c) => String(c).trim()).filter(Boolean)
      : [],
    sources: Array.isArray(v.sources)
      ? (v.sources as unknown[])
          .map((s2) => s2 as Record<string, unknown>)
          .filter((s2) => str(s2?.title) && str(s2?.url))
          .map((s2) => ({ title: String(s2.title).trim(), url: String(s2.url).trim() }))
      : [],
  };
}
