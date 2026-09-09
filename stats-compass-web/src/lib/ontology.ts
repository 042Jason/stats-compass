/**
 * 온톨로지 그래프 타입과 클라이언트에서도 쓰는 헬퍼.
 *
 * 스키마는 supabase/0004_ontology.sql, 설계 근거는 docs/ontology-design.md 를 보세요.
 * 서버 전용 코드가 섞이면 클라이언트 컴포넌트에서 못 쓰므로 여기에는 순수 로직만 둡니다.
 */

export interface OntologyClass {
  id: string;
  label: string;
  description: string | null;
  std_prefix: string | null;
  std_uri: string | null;
  sdmx_note: string | null;
  color: string | null;
  sort_order: number;
}

export interface OntologyProperty {
  id: string;
  label: string;
  description: string | null;
  domain_class: string | null;
  range_class: string | null;
  std_prefix: string | null;
  std_uri: string | null;
  symmetric: boolean;
  sort_order: number;
}

export interface OntologyNode {
  id: string;
  class: string;
  key: string;
  label: string;
  alt: string[];
  desc: string | null;
  stdUri: string | null;
  statId: string | null;
  weight: number;
  props: Record<string, unknown>;
}

export interface OntologyEdge {
  /** property_id */
  p: string;
  /** source entity id */
  s: string;
  /** target entity id */
  t: string;
  /** weight */
  w: number;
  /** evidence */
  why: string | null;
}

export interface OntologySnapshot {
  classes: OntologyClass[];
  properties: OntologyProperty[];
  nodes: OntologyNode[];
  edges: OntologyEdge[];
}

export const EMPTY_SNAPSHOT: OntologySnapshot = {
  classes: [],
  properties: [],
  nodes: [],
  edges: [],
};

/* ── 파싱 ───────────────────────────────────────────────────────────────── */

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const strOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const num = (v: unknown, fallback = 1): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** RPC 응답(jsonb)을 방어적으로 정규화합니다. 형태가 어긋난 항목은 버립니다. */
export function toSnapshot(value: unknown): OntologySnapshot {
  if (!value || typeof value !== "object") return EMPTY_SNAPSHOT;
  const raw = value as Record<string, unknown>;

  const classes: OntologyClass[] = (Array.isArray(raw.classes) ? raw.classes : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      id: str(c.id),
      label: str(c.label),
      description: strOrNull(c.description),
      std_prefix: strOrNull(c.std_prefix),
      std_uri: strOrNull(c.std_uri),
      sdmx_note: strOrNull(c.sdmx_note),
      color: strOrNull(c.color),
      sort_order: num(c.sort_order, 100),
    }))
    .filter((c) => c.id !== "");

  const properties: OntologyProperty[] = (Array.isArray(raw.properties) ? raw.properties : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      id: str(p.id),
      label: str(p.label),
      description: strOrNull(p.description),
      domain_class: strOrNull(p.domain_class),
      range_class: strOrNull(p.range_class),
      std_prefix: strOrNull(p.std_prefix),
      std_uri: strOrNull(p.std_uri),
      // DB 컬럼은 is_symmetric (symmetric 은 PostgreSQL 예약어)
      symmetric: p.is_symmetric === true,
      sort_order: num(p.sort_order, 100),
    }))
    .filter((p) => p.id !== "");

  const nodes: OntologyNode[] = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .map((n) => ({
      id: str(n.id),
      class: str(n.class),
      key: str(n.key),
      label: str(n.label),
      alt: Array.isArray(n.alt) ? n.alt.map(str).filter(Boolean) : [],
      desc: strOrNull(n.desc),
      stdUri: strOrNull(n.stdUri),
      statId: strOrNull(n.statId),
      weight: num(n.weight, 1),
      props: n.props && typeof n.props === "object" ? (n.props as Record<string, unknown>) : {},
    }))
    .filter((n) => n.id !== "" && n.label !== "");

  const known = new Set(nodes.map((n) => n.id));
  const edges: OntologyEdge[] = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      p: str(e.p),
      s: str(e.s),
      t: str(e.t),
      w: num(e.w, 1),
      why: strOrNull(e.why),
    }))
    .filter((e) => e.p !== "" && known.has(e.s) && known.has(e.t) && e.s !== e.t);

  return { classes, properties, nodes, edges };
}

/* ── 표시용 헬퍼 ────────────────────────────────────────────────────────── */

const FALLBACK_COLOR = "#64748b";

export function classColor(classes: OntologyClass[], classId: string): string {
  return classes.find((c) => c.id === classId)?.color ?? FALLBACK_COLOR;
}

export function classLabel(classes: OntologyClass[], classId: string): string {
  return classes.find((c) => c.id === classId)?.label ?? classId;
}

export function propertyLabel(properties: OntologyProperty[], propertyId: string): string {
  return properties.find((p) => p.id === propertyId)?.label ?? propertyId;
}

/** prefix + 로컬명으로 축약 (http://www.w3.org/ns/dcat#Dataset → dcat:Dataset) */
export function compactUri(prefix: string | null, uri: string | null): string | null {
  if (!uri) return null;
  const local = uri.split(/[#/]/).filter(Boolean).pop();
  if (!local) return uri;
  return prefix ? `${prefix}:${local}` : local;
}
