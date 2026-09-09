"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import type { RagResult } from "@/lib/graphrag";
import type { ResolvedSlots } from "@/lib/slots";

/**
 * GraphRAG 활성화 뷰.
 *
 * 온톨로지 전체를 그리지 않습니다. 이 질문 하나를 처리하면서 <실제로 켜진> 노드만
 * 왼쪽에서 오른쪽으로 늘어놓아, 질문 조각이 어떤 경로로 통계표까지 갔는지 보이게 합니다.
 * 후보까지 갔다가 밀린 조사는 흐리게 그려 "무엇을 안 골랐는지" 도 함께 보여 줍니다.
 *
 * 위치를 계산으로 고정합니다. 힘기반 배치는 매번 자리가 달라져 경로를 설명할 수 없습니다.
 *
 * 열이 하나씩 켜집니다. 한 번에 다 그려 놓으면 그냥 표 다섯 개일 뿐이고,
 * "질문 조각에서 출발해 필요한 것만 골라 통계표까지 간다" 는 흐름이 안 보입니다.
 */

/** 열이 하나씩 켜지는 간격 */
const REVEAL_MS = 700;

const STEP_CAPTION = [
  "질문에서 나이·지역·성별을 떼어냅니다",
  "별칭과 본문으로 가까운 노드를 찾습니다 (어휘 + 벡터)",
  "관계를 타고 조사에 도달합니다 — 흐린 것은 점수에서 밀린 조사",
  "조사들이 공유하는 통계용어가 서로를 잇습니다",
  "각 조사의 대표 통계표를 골라 KOSIS 로 넘길 ID를 확정합니다",
];

const STEP = 34;
const NODE_H = 26;
const TOP = 34;

interface Col {
  key: string;
  x: number;
  w: number;
  title: string;
}

const COLS: Col[] = [
  { key: "slot", x: 6, w: 118, title: "질문 조각" },
  { key: "seed", x: 158, w: 158, title: "걸린 노드" },
  { key: "survey", x: 350, w: 176, title: "조사" },
  { key: "concept", x: 560, w: 150, title: "통계용어" },
  { key: "table", x: 744, w: 268, title: "통계표" },
];

const VB_W = 1020;

interface Node {
  id: string;
  col: number;
  row: number;
  label: string;
  sub?: string;
  tip?: string;
  tone: "slot" | "seed" | "survey" | "concept" | "table" | "faded";
}

interface Edge {
  from: string;
  to: string;
  kind: "solid" | "rule" | "warn";
}

/** 폭에 맞춰 글자를 자릅니다. 한글 기준 대략 10.2px/자 */
function fit(text: string, w: number): string {
  const cap = Math.max(4, Math.floor((w - 14) / 10.2));
  return text.length <= cap ? text : text.slice(0, cap - 1) + "…";
}

const TONE: Record<Node["tone"], { fill: string; stroke: string; text: string; dash?: string }> = {
  slot: { fill: "var(--secondary)", stroke: "var(--input)", text: "var(--foreground)" },
  seed: { fill: "var(--primary-soft)", stroke: "var(--primary)", text: "var(--primary)" },
  survey: { fill: "var(--primary)", stroke: "var(--primary)", text: "#ffffff" },
  concept: { fill: "#fdf2f8", stroke: "#be185d", text: "#9d174d" },
  table: { fill: "var(--card)", stroke: "var(--border)", text: "var(--foreground)" },
  faded: { fill: "var(--card)", stroke: "var(--input)", text: "var(--muted-foreground)", dash: "3 3" },
};

export function GraphView({ result, slots }: { result: RagResult; slots: ResolvedSlots }) {
  /* 지금 몇 번째 열까지 켜졌는가. -1 은 아직 아무것도 안 켜진 상태입니다. */
  const [step, setStep] = useState(-1);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    setStep(-1);
    const timers = COLS.map((_, i) =>
      setTimeout(() => setStep(i), REVEAL_MS * (i + 1)),
    );
    return () => timers.forEach(clearTimeout);
  }, [runId]);

  /* ── 열별 항목 만들기 ─────────────────────────────────────────── */

  const slotItems: Array<{ label: string; sub: string; match: string[] }> = [];
  if (slots.age !== null) {
    slotItems.push({
      label: slots.ageText ?? `${slots.age}세`,
      sub: "나이",
      match: ["AgeBand", "LifeStage"],
    });
  }
  if (slots.regions.length > 0) {
    slotItems.push({
      label: slots.regions[0].matched ?? slots.regions[0].label,
      sub: "지역",
      match: ["Region"],
    });
  }
  if (slots.sex) slotItems.push({ label: slots.sex, sub: "성별", match: ["Sex"] });

  const seeds = result.seeds.slice(0, 7);
  const surveys = result.surveys.slice(0, 8);
  const dropped = result.dropped.slice(0, 4);
  const concepts = [...result.concepts]
    .sort((a, b) => b.surveys.length - a.surveys.length || a.label.localeCompare(b.label, "ko"))
    .slice(0, 5);
  const tables = result.tables.slice(0, 12);

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  slotItems.forEach((s, i) =>
    nodes.push({ id: `sl${i}`, col: 0, row: i, label: s.label, sub: s.sub, tone: "slot" }),
  );

  seeds.forEach((s, i) => {
    nodes.push({
      id: `sd${i}`,
      col: 1,
      row: i,
      label: s.label,
      sub: `${s.class} · ${s.sim.toFixed(2)}`,
      tip: `${s.class} · 유사도 ${s.sim.toFixed(2)}`,
      tone: "seed",
    });
    // 규칙으로 이어진 것 — 나이·지역·성별 슬롯이 그 축의 노드를 켠 경우
    slotItems.forEach((sl, j) => {
      if (sl.match.includes(s.class)) edges.push({ from: `sl${j}`, to: `sd${i}`, kind: "rule" });
    });
  });

  surveys.forEach((sv, i) => {
    nodes.push({
      id: `sv${i}`,
      col: 2,
      row: i,
      label: sv.label,
      sub: `관련도 ${sv.score.toFixed(3)}`,
      tip: sv.overview ?? undefined,
      tone: "survey",
    });
    seeds.forEach((sd, j) => {
      if (sv.paths.some((p) => p.from === sd.label)) {
        edges.push({ from: `sd${j}`, to: `sv${i}`, kind: "solid" });
      }
    });
  });

  dropped.forEach((d, i) => {
    const id = `dp${i}`;
    nodes.push({
      id,
      col: 2,
      row: surveys.length + i,
      label: d.label,
      sub: d.confusedWith ? `혼동쌍 · ${d.confusedWith}` : `관련도 ${d.score.toFixed(3)}`,
      tip: d.confusedWith
        ? `점수에서 밀렸습니다. ${d.confusedWith} 와 혼동쌍으로 등록된 조사입니다.`
        : "후보까지 갔지만 점수에서 밀렸습니다.",
      tone: "faded",
    });
    const partner = surveys.findIndex((sv) => sv.label === d.confusedWith);
    if (partner >= 0) edges.push({ from: `sv${partner}`, to: id, kind: "warn" });
  });

  concepts.forEach((c, i) => {
    nodes.push({
      id: `cp${i}`,
      col: 3,
      row: i,
      label: c.label,
      sub: c.surveys.length > 1 ? `${c.surveys.length}개 조사 공유` : undefined,
      tip: c.definition ?? undefined,
      tone: "concept",
    });
    surveys.forEach((sv, j) => {
      if (c.surveys.includes(sv.label)) edges.push({ from: `sv${j}`, to: `cp${i}`, kind: "solid" });
    });
  });

  tables.forEach((t, i) => {
    nodes.push({
      id: `tb${i}`,
      col: 4,
      row: i,
      label: t.label,
      sub: [t.tblId, t.survey].filter(Boolean).join(" · "),
      tip: t.label,
      tone: "table",
    });
    const owner = surveys.findIndex((sv) => sv.label === t.survey);
    if (owner >= 0) edges.push({ from: `sv${owner}`, to: `tb${i}`, kind: "solid" });
  });

  if (nodes.length === 0) return null;

  /* ── 좌표 ────────────────────────────────────────────────────── */

  const counts = COLS.map((_, c) => nodes.filter((n) => n.col === c).length);
  const maxRows = Math.max(...counts, 1);
  const VB_H = TOP + maxRows * STEP + 12;

  const startY = (c: number) => TOP + ((maxRows - counts[c]) * STEP) / 2;
  const pos = new Map<string, { x: number; y: number; w: number }>();
  const nodeCol = new Map<string, number>();
  for (const n of nodes) {
    pos.set(n.id, { x: COLS[n.col].x, y: startY(n.col) + n.row * STEP, w: COLS[n.col].w });
    nodeCol.set(n.id, n.col);
  }

  const EDGE_STYLE: Record<Edge["kind"], { stroke: string; dash?: string; op: number }> = {
    solid: { stroke: "var(--primary)", op: 0.28 },
    rule: { stroke: "var(--muted-foreground)", dash: "4 3", op: 0.5 },
    warn: { stroke: "#b45309", dash: "4 3", op: 0.75 },
  };

  return (
    <section aria-labelledby="graph">
      <h2 id="graph" className="text-lg font-bold">
        이 질문이 그래프를 어떻게 지나갔는가
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        온톨로지 전체가 아니라 이 질문 하나로 <strong>실제로 켜진 노드</strong>만 그렸습니다.
        흐린 것은 후보까지 갔다가 밀린 조사입니다.
      </p>

      {/* 진행 표시 + 다시 재생 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ol className="flex flex-wrap gap-1.5">
          {COLS.map((c, i) => (
            <li
              key={c.key}
              className={[
                "rounded-md border px-2 py-0.5 text-xs transition-colors duration-300",
                i <= step
                  ? "border-primary/40 bg-primary-soft font-semibold text-primary"
                  : "border-border text-muted-foreground/60",
              ].join(" ")}
            >
              {c.title}
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => setRunId((n) => n + 1)}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-muted"
        >
          <Play className="size-3" aria-hidden />
          다시 재생
        </button>
      </div>

      <p className="mt-2 min-h-5 text-sm text-primary transition-opacity duration-300">
        {step >= 0 ? STEP_CAPTION[step] : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="mr-1 inline-block h-2 w-4 align-middle" style={{ background: "var(--primary)" }} />
          채택된 조사
        </span>
        <span>
          <span
            className="mr-1 inline-block h-2 w-4 border align-middle"
            style={{ borderColor: "var(--input)", borderStyle: "dashed" }}
          />
          밀린 조사
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-4 align-middle" style={{ background: "#be185d" }} />
          통계용어
        </span>
        <span>— 실선: 그래프 관계 · 점선: 규칙(나이·지역 해석) · 주황 점선: 혼동쌍</span>
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card p-2">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width={VB_W}
          height={VB_H}
          role="img"
          aria-label="질문에서 통계표까지의 활성화 경로"
          style={{ maxWidth: "none", minWidth: VB_W }}
        >
          {COLS.map((c, i) => (
            <text
              key={c.key}
              x={c.x}
              y={16}
              fontSize={11}
              fontWeight={700}
              fill={i <= step ? "var(--primary)" : "var(--muted-foreground)"}
              opacity={i <= step ? 1 : 0.45}
              style={{ transition: "fill .4s, opacity .4s" }}
            >
              {c.title}
            </text>
          ))}

          {edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + a.w;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            const y2 = b.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            const st = EDGE_STYLE[e.kind];
            // 양끝이 다 켜져야 선을 긋습니다. 아직 안 켜진 열로 선이 먼저 뻗으면
            // "무엇이 무엇을 불러왔는지" 순서가 거꾸로 보입니다.
            const on = nodeCol.get(e.from)! <= step && nodeCol.get(e.to)! <= step;
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={st.stroke}
                strokeWidth={1.2}
                strokeDasharray={st.dash}
                opacity={on ? st.op : 0}
                style={{ transition: "opacity .5s ease-out" }}
              />
            );
          })}

          {nodes.map((n) => {
            const p = pos.get(n.id)!;
            const t = TONE[n.tone];
            const faded = n.tone === "faded";
            // 아직 차례가 안 온 열은 자리만 잡아 두고 흐리게 둡니다.
            // 아예 감추면 열이 켜질 때마다 전체 배치가 흔들려 눈이 피곤합니다.
            const on = n.col <= step;
            return (
              <g
                key={n.id}
                opacity={on ? (faded ? 0.55 : 1) : 0.08}
                style={{
                  transition: "opacity .55s ease-out, transform .55s ease-out",
                  transform: on ? "none" : "translateX(-6px)",
                }}
              >
                {n.tip && <title>{n.tip}</title>}
                <rect
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height={NODE_H}
                  rx={5}
                  fill={t.fill}
                  stroke={t.stroke}
                  strokeWidth={1.2}
                  strokeDasharray={t.dash}
                />
                <text x={p.x + 7} y={p.y + (n.sub ? 11 : 17)} fontSize={10.5} fill={t.text}>
                  {fit(n.label, p.w)}
                </text>
                {n.sub && (
                  <text
                    x={p.x + 7}
                    y={p.y + 21}
                    fontSize={8.5}
                    fill={t.text}
                    opacity={n.tone === "survey" ? 0.75 : 0.6}
                  >
                    {fit(n.sub, p.w)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
