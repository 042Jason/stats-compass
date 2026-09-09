"use client";

/**
 * 온톨로지 그래프 탐색기.
 *
 * d3-force 로 레이아웃만 계산하고 렌더링은 SVG 로 합니다.
 * 시뮬레이션을 애니메이션으로 돌리지 않고 한 번에 400틱을 돌린 뒤 정지 상태로 그립니다.
 * 노드가 수백 개라 매 프레임 리렌더링하면 버벅이기 때문입니다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  classColor,
  classLabel,
  compactUri,
  propertyLabel,
  type OntologyEdge,
  type OntologyNode,
  type OntologySnapshot,
} from "@/lib/ontology";
import { cn } from "@/lib/utils";

const WIDTH = 1200;
const HEIGHT = 820;

/** 한 번에 그릴 수 있는 상한. 넘으면 가중치가 높은 노드부터 남깁니다. */
const MAX_NODES = 700;

interface Preset {
  id: string;
  label: string;
  hint: string;
  classes: string[];
  properties: string[];
}

const PRESETS: Preset[] = [
  {
    id: "surveys",
    label: "조사 관계망",
    hint: "조사끼리 어떻게 이어지는지만 봅니다",
    classes: ["Survey"],
    properties: ["oftenConfusedWith", "sharesConceptWith", "relatedTo", "complements", "supersedes"],
  },
  {
    id: "concepts",
    label: "개념 지도",
    hint: "용어를 가운데 두고 조사를 이어 봅니다",
    classes: ["Survey", "Concept"],
    properties: ["definesConcept", "broaderConcept", "relatedConcept"],
  },
  {
    id: "catalog",
    label: "카탈로그 구조",
    hint: "기관·주제·주기 같은 카탈로그 축입니다",
    classes: ["Catalog", "Survey", "Agency", "Theme", "Frequency", "LegalBasis"],
    properties: ["inCatalog", "producedBy", "hasTheme", "hasFrequency", "basedOn"],
  },
  {
    id: "confusion",
    label: "헷갈리는 통계",
    hint: "서로 다르니 섞으면 안 되는 조사쌍",
    classes: ["Survey"],
    properties: ["oftenConfusedWith"],
  },
];

interface SimNode extends SimulationNodeDatum {
  id: string;
  node: OntologyNode;
  r: number;
}
type SimLink = SimulationLinkDatum<SimNode> & { edge: OntologyEdge };

interface Layout {
  nodes: Array<SimNode & { x: number; y: number }>;
  links: Array<{ edge: OntologyEdge; x1: number; y1: number; x2: number; y2: number }>;
}

export function GraphExplorer({ snapshot }: { snapshot: OntologySnapshot }) {
  const { classes, properties, nodes, edges } = snapshot;

  const [presetId, setPresetId] = useState<string>("surveys");
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];

  const [activeClasses, setActiveClasses] = useState<Set<string>>(new Set(preset.classes));
  const [activeProps, setActiveProps] = useState<Set<string>>(new Set(preset.properties));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [neighborsOnly, setNeighborsOnly] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });

  const applyPreset = useCallback((p: Preset) => {
    setPresetId(p.id);
    setActiveClasses(new Set(p.classes));
    setActiveProps(new Set(p.properties));
    setNeighborsOnly(false);
    setView({ x: 0, y: 0, k: 1 });
  }, []);

  /* ── 표시 대상 추리기 ─────────────────────────────────────────────── */

  const { viewNodes, viewEdges, trimmed } = useMemo(() => {
    let ns = nodes.filter((n) => activeClasses.has(n.class));
    let allowed = new Set(ns.map((n) => n.id));
    let es = edges.filter((e) => activeProps.has(e.p) && allowed.has(e.s) && allowed.has(e.t));

    if (neighborsOnly && selectedId) {
      const keep = new Set<string>([selectedId]);
      for (const e of es) {
        if (e.s === selectedId) keep.add(e.t);
        else if (e.t === selectedId) keep.add(e.s);
      }
      ns = ns.filter((n) => keep.has(n.id));
      allowed = new Set(ns.map((n) => n.id));
      es = es.filter((e) => allowed.has(e.s) && allowed.has(e.t));
    }

    let cut = false;
    if (ns.length > MAX_NODES) {
      cut = true;
      ns = [...ns].sort((a, b) => b.weight - a.weight).slice(0, MAX_NODES);
      allowed = new Set(ns.map((n) => n.id));
      es = es.filter((e) => allowed.has(e.s) && allowed.has(e.t));
    }
    return { viewNodes: ns, viewEdges: es, trimmed: cut };
  }, [nodes, edges, activeClasses, activeProps, neighborsOnly, selectedId]);

  /* ── 레이아웃 계산 (클라이언트에서만) ─────────────────────────────── */

  useEffect(() => {
    if (viewNodes.length === 0) {
      setLayout({ nodes: [], links: [] });
      return;
    }
    const degree = new Map<string, number>();
    for (const e of viewEdges) {
      degree.set(e.s, (degree.get(e.s) ?? 0) + 1);
      degree.set(e.t, (degree.get(e.t) ?? 0) + 1);
    }
    const sim: SimNode[] = viewNodes.map((n) => ({
      id: n.id,
      node: n,
      r: 5 + Math.min(14, Math.sqrt(degree.get(n.id) ?? 0) * 3),
    }));
    const byId = new Map(sim.map((s) => [s.id, s]));
    const links: SimLink[] = viewEdges
      .map((e) => ({ source: byId.get(e.s)!, target: byId.get(e.t)!, edge: e }))
      .filter((l) => l.source && l.target);

    const simulation: Simulation<SimNode, SimLink> = forceSimulation(sim)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => 70 + 40 / (1 + l.edge.w))
          .strength(0.4),
      )
      .force("charge", forceManyBody<SimNode>().strength(sim.length > 200 ? -110 : -260))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 8))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      .force("x", forceX(WIDTH / 2).strength(0.03))
      .force("y", forceY(HEIGHT / 2).strength(0.05))
      .stop();

    simulation.tick(400);

    setLayout({
      nodes: sim.map((s) => ({ ...s, x: s.x ?? WIDTH / 2, y: s.y ?? HEIGHT / 2 })),
      links: links.map((l) => {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        return { edge: l.edge, x1: s.x ?? 0, y1: s.y ?? 0, x2: t.x ?? 0, y2: t.y ?? 0 };
      }),
    });
  }, [viewNodes, viewEdges]);

  /* ── 강조 대상 ────────────────────────────────────────────────────── */

  const focusId = hoverId ?? selectedId;
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const s = new Set<string>([focusId]);
    for (const e of viewEdges) {
      if (e.s === focusId) s.add(e.t);
      else if (e.t === focusId) s.add(e.s);
    }
    return s;
  }, [focusId, viewEdges]);

  const matchSet = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return null;
    return new Set(
      viewNodes
        .filter(
          (n) =>
            n.label.toLowerCase().includes(q) ||
            n.alt.some((a) => a.toLowerCase().includes(q)),
        )
        .map((n) => n.id),
    );
  }, [query, viewNodes]);

  const selected = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null;
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const selectedRelations = useMemo(() => {
    if (!selectedId) return [];
    const groups = new Map<string, Array<{ other: OntologyNode; why: string | null; w: number }>>();
    for (const e of edges) {
      const otherId = e.s === selectedId ? e.t : e.t === selectedId ? e.s : null;
      if (!otherId) continue;
      const other = nodeById.get(otherId);
      if (!other) continue;
      const list = groups.get(e.p) ?? [];
      list.push({ other, why: e.why, w: e.w });
      groups.set(e.p, list);
    }
    return [...groups.entries()]
      .map(([p, list]) => ({
        property: p,
        label: propertyLabel(properties, p),
        items: list.sort((a, b) => b.w - a.w),
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [selectedId, edges, nodeById, properties]);

  /* ── 팬·줌 ────────────────────────────────────────────────────────── */

  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setView((v) => ({ ...v, k: Math.min(4, Math.max(0.35, v.k * (e.deltaY < 0 ? 1.12 : 0.89))) }));
  }, []);

  const classCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) m.set(n.class, (m.get(n.class) ?? 0) + 1);
    return m;
  }, [nodes]);

  const propCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) m.set(e.p, (m.get(e.p) ?? 0) + 1);
    return m;
  }, [edges]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const vb = `${view.x + (WIDTH * (1 - 1 / view.k)) / 2} ${
    view.y + (HEIGHT * (1 - 1 / view.k)) / 2
  } ${WIDTH / view.k} ${HEIGHT / view.k}`;

  return (
    <div className="space-y-4">
      {/* 프리셋 */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p)}
            aria-pressed={presetId === p.id}
            title={p.hint}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              presetId === p.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground/80 hover:border-primary/40 hover:text-primary",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{preset.hint}</p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 그래프 */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="노드 이름으로 찾기"
              aria-label="노드 검색"
              className="h-9 min-w-52 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setNeighborsOnly((v) => !v)}
              disabled={!selectedId}
              aria-pressed={neighborsOnly}
              className={cn(
                "h-9 rounded-md border px-3 text-sm transition-colors disabled:opacity-40",
                neighborsOnly
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              이웃만 보기
            </button>
            <button
              type="button"
              onClick={() => setView({ x: 0, y: 0, k: 1 })}
              className="h-9 rounded-md border border-border bg-card px-3 text-sm hover:border-primary/40"
            >
              화면 맞춤
            </button>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-border bg-card">
            <svg
              viewBox={vb}
              width="100%"
              className="block h-[560px] w-full cursor-grab touch-none active:cursor-grabbing"
              role="img"
              aria-label="온톨로지 관계 그래프"
              onWheel={onWheel}
              onPointerDown={(e) => {
                dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
                (e.target as Element).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                setView((v) => ({
                  ...v,
                  x: d.vx - (e.clientX - d.x) / v.k,
                  y: d.vy - (e.clientY - d.y) / v.k,
                }));
              }}
              onPointerUp={() => {
                dragRef.current = null;
              }}
            >
              {layout?.links.map((l, i) => {
                const dim = focusSet && !(focusSet.has(l.edge.s) && focusSet.has(l.edge.t));
                return (
                  <line
                    key={i}
                    x1={l.x1}
                    y1={l.y1}
                    x2={l.x2}
                    y2={l.y2}
                    stroke={l.edge.p === "oftenConfusedWith" ? "#dc2626" : "#94a3b8"}
                    strokeOpacity={dim ? 0.06 : l.edge.p === "oftenConfusedWith" ? 0.6 : 0.28}
                    strokeWidth={Math.min(4, 0.8 + l.edge.w * 0.35)}
                  />
                );
              })}
              {layout?.nodes.map((n) => {
                const dim = focusSet && !focusSet.has(n.id);
                const hit = matchSet?.has(n.id);
                const color = classColor(classes, n.node.class);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    opacity={dim ? 0.15 : 1}
                    onPointerEnter={() => setHoverId(n.id)}
                    onPointerLeave={() => setHoverId(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(n.id);
                    }}
                    className="cursor-pointer"
                  >
                    <circle
                      r={n.r}
                      fill={color}
                      stroke={
                        selectedId === n.id ? "#0f172a" : hit ? "#f59e0b" : "rgba(255,255,255,.85)"
                      }
                      strokeWidth={selectedId === n.id || hit ? 3 : 1.5}
                    />
                    {(n.r >= 9 || selectedId === n.id || hoverId === n.id || hit) && (
                      <text
                        y={-n.r - 5}
                        textAnchor="middle"
                        className="pointer-events-none select-none"
                        style={{ fontSize: 11, fill: "#0f172a", paintOrder: "stroke" }}
                        stroke="rgba(255,255,255,.9)"
                        strokeWidth={3}
                      >
                        {n.node.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            <div className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted-foreground">
              노드 {viewNodes.length} · 관계 {viewEdges.length}
              {trimmed && ` (가중치 상위 ${MAX_NODES}개만 표시)`}
            </div>
          </div>

          {/* 범례 = 클래스 필터 */}
          <div className="flex flex-wrap gap-2">
            {classes
              .filter((c) => (classCounts.get(c.id) ?? 0) > 0)
              .map((c) => {
                const on = activeClasses.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveClasses((s) => toggle(s, c.id))}
                    aria-pressed={on}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
                      on ? "border-border bg-card" : "border-dashed border-border/60 opacity-45",
                    )}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: c.color ?? "#64748b" }}
                      aria-hidden
                    />
                    {c.label}
                    <span className="text-muted-foreground">{classCounts.get(c.id)}</span>
                  </button>
                );
              })}
          </div>

          {/* 관계 필터 */}
          <div className="flex flex-wrap gap-2">
            {properties
              .filter((p) => (propCounts.get(p.id) ?? 0) > 0)
              .map((p) => {
                const on = activeProps.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveProps((s) => toggle(s, p.id))}
                    aria-pressed={on}
                    title={p.description ?? undefined}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      on
                        ? "border-primary/40 bg-primary/5 text-primary"
                        : "border-dashed border-border/60 text-muted-foreground opacity-60",
                    )}
                  >
                    {p.label}
                    <span className="ml-1.5 opacity-60">{propCounts.get(p.id)}</span>
                  </button>
                );
              })}
          </div>
        </div>

        {/* 상세 패널 */}
        <aside className="rounded-xl border border-border bg-card p-5">
          {!selected ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">노드를 클릭해 보세요</p>
              <p>
                조사·개념·기관이 어떻게 이어지는지 보여 줍니다. 빨간 선은 &ldquo;서로 다르니 섞어
                쓰면 안 되는&rdquo; 조사쌍입니다.
              </p>
              <p>휠로 확대·축소하고, 빈 곳을 끌어 이동합니다.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: `${classColor(classes, selected.class)}1a`,
                    color: classColor(classes, selected.class),
                  }}
                >
                  {classLabel(classes, selected.class)}
                </span>
                <h2 className="mt-2 text-lg font-bold leading-snug">{selected.label}</h2>
                {selected.alt.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    다른 표기: {selected.alt.join(", ")}
                  </p>
                )}
              </div>

              {selected.desc && <p className="text-sm leading-6">{selected.desc}</p>}

              {selected.statId && (
                <Link
                  href={`/statistics/${encodeURIComponent(selected.statId)}`}
                  className="inline-block rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  조사 상세 보기
                </Link>
              )}

              {selected.stdUri && (
                <p className="break-all text-xs text-muted-foreground">
                  표준 코드:{" "}
                  <a
                    href={selected.stdUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-primary"
                  >
                    {selected.stdUri}
                  </a>
                </p>
              )}

              <div className="space-y-3 border-t border-border pt-3">
                {selectedRelations.map((g) => (
                  <div key={g.property}>
                    <p className="text-xs font-semibold text-primary">
                      {g.label}
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {g.items.length}
                      </span>
                    </p>
                    <ul className="mt-1 space-y-1">
                      {g.items.slice(0, 12).map(({ other, why }) => (
                        <li key={other.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(other.id);
                              setActiveClasses((s) => new Set([...s, other.class]));
                            }}
                            className="text-left text-sm hover:text-primary hover:underline"
                          >
                            {other.label}
                          </button>
                          {g.property === "oftenConfusedWith" && why && (
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{why}</p>
                          )}
                        </li>
                      ))}
                      {g.items.length > 12 && (
                        <li className="text-xs text-muted-foreground">
                          외 {g.items.length - 12}개
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
                {selectedRelations.length === 0 && (
                  <p className="text-sm text-muted-foreground">연결된 관계가 없습니다.</p>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* 표준 매핑 */}
      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer list-none p-4 text-sm font-medium hover:text-primary">
          이 그래프의 어휘와 표준 매핑 (DCAT · SKOS · SDMX)
        </summary>
        <div className="space-y-4 border-t border-border p-5">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">클래스와 표준 어휘 매핑</caption>
              <thead className="bg-muted/60">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">클래스</th>
                  <th scope="col" className="px-3 py-2 font-semibold">표준</th>
                  <th scope="col" className="px-3 py-2 font-semibold">SDMX 대응</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {classes.map((c) => (
                  <tr key={c.id} className="align-top">
                    <th scope="row" className="px-3 py-2 font-medium">{c.label}</th>
                    <td className="px-3 py-2 font-mono text-xs">
                      {compactUri(c.std_prefix, c.std_uri) ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{c.sdmx_note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">관계와 표준 어휘 매핑</caption>
              <thead className="bg-muted/60">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">관계</th>
                  <th scope="col" className="px-3 py-2 font-semibold">표준</th>
                  <th scope="col" className="px-3 py-2 font-semibold">설명</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {properties.map((p) => (
                  <tr key={p.id} className="align-top">
                    <th scope="row" className="px-3 py-2 font-medium">{p.label}</th>
                    <td className="px-3 py-2 font-mono text-xs">
                      {compactUri(p.std_prefix, p.std_uri) ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
