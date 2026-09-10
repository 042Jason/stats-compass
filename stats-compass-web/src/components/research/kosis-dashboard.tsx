"use client";

import { useMemo, useState } from "react";
import { BarChart3, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { kosisTableUrl, type RagTable } from "@/lib/graphrag";
import { formatPeriod, PRD_LABEL, type KosisSeries } from "@/lib/kosis-types";

/**
 * 나침반이 찾은 통계표ID를 KOSIS 로 넘겨 실제 수치를 받아 그립니다.
 *
 * 나침반은 "어느 표를 봐야 하는가" 까지만 답합니다. 숫자는 KOSIS 가 원본입니다.
 * 그 경계를 화면에서도 지켜야 나중에 수치 출처를 두고 헷갈리지 않습니다.
 */

const COUNTS = [3, 5, 10];
/** "auto" 는 표마다 DB 에 저장된 그 표의 주기를 씁니다 */
const PERIODS = ["auto", "Y", "H", "Q", "M"] as const;
const PERIOD_LABEL: Record<string, string> = { auto: "표별 수록주기", ...PRD_LABEL };

function fmt(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

/** "연간 · 2016~2024" 처럼 이 표가 어디부터 어디까지 있는지 */
function coverage(t: { prdSe: string | null; firstPeriod: string | null; latestPeriod: string | null }): string {
  const cycle = t.prdSe ? (PRD_LABEL[t.prdSe] ?? t.prdSe) : null;
  const span =
    t.firstPeriod && t.latestPeriod
      ? `${t.firstPeriod}~${t.latestPeriod}`
      : (t.latestPeriod ?? null);
  return [cycle, span].filter(Boolean).join(" · ");
}

/** orgId·tblId 가 실제로 있는 표만. 없으면 KOSIS 를 부를 수가 없습니다. */
type Callable = RagTable & { orgId: string; tblId: string };

export function KosisDashboard({ tables }: { tables: RagTable[] }) {
  const usable = useMemo(
    () => tables.filter((t): t is Callable => Boolean(t.orgId) && Boolean(t.tblId)),
    [tables],
  );

  // 디폴트는 전부 선택입니다.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(usable.map((t) => `${t.orgId}-${t.tblId}`)),
  );
  const [prdSe, setPrdSe] = useState<string>("auto");
  const [count, setCount] = useState<number>(5);
  const [series, setSeries] = useState<KosisSeries[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (usable.length === 0) return null;

  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const allOn = picked.size === usable.length;

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const items = usable
        .filter((t) => picked.has(`${t.orgId}-${t.tblId}`))
        // knownPrdSe 는 DB 가 아는 그 표의 주기입니다. "표별 수록주기" 를 고르면
        // 서버가 표마다 이 값을 씁니다 — 연간 표에 월간을 요청해 빈 결과가 되는 일을 막습니다.
        .map((t) => ({ orgId: t.orgId, tblId: t.tblId, knownPrdSe: t.prdSe }));
      const res = await fetch("/api/kosis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, prdSe: prdSe === "auto" ? null : prdSe, count }),
      });
      const json = (await res.json()) as { series?: KosisSeries[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `요청 실패 (${res.status})`);
      setSeries(json.series ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSeries(null);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 카드 순서는 위 통계표 목록이 정합니다.
   *
   * series 는 요청을 보낸 순서 그대로 돌아옵니다. 수치를 불러온 뒤에 정렬을
   * 바꾸면 목록과 카드가 어긋나므로, 그릴 때마다 목록 순서로 다시 세웁니다.
   */
  function rankOf(s: { orgId: string; tblId: string }): number {
    const i = usable.findIndex((t) => t.orgId === s.orgId && t.tblId === s.tblId);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  }
  function byOrder(a: KosisSeries, b: KosisSeries): number {
    return rankOf(a) - rankOf(b);
  }

  const ok = (series?.filter((s) => s.error === null) ?? []).slice().sort(byOrder);
  const bad = (series?.filter((s) => s.error !== null) ?? []).slice().sort(byOrder);

  /** orgId-tblId → 나침반이 아는 통계표명 */
  const labelOf = (key: string): string | null =>
    usable.find((t) => `${t.orgId}-${t.tblId}` === key)?.label ?? null;

  return (
    <section aria-labelledby="kosis">
      <h2 id="kosis" className="flex items-center gap-2 text-lg font-bold">
        <BarChart3 className="size-5 text-primary" aria-hidden />
        수치로 보기
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        나침반은 <strong>통계표ID까지</strong> 찾습니다. 아래 숫자는 그 ID를 KOSIS
        공유서비스에 넘겨 받아온 <strong>원본 값</strong>입니다.
      </p>

      {/* 선택 패널 */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={allOn}
              onChange={() =>
                setPicked(allOn ? new Set() : new Set(usable.map((t) => `${t.orgId}-${t.tblId}`)))
              }
            />
            전체 선택 ({picked.size}/{usable.length})
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">주기</span>
            <select
              value={prdSe}
              onChange={(e) => setPrdSe(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">시점 수</span>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {COUNTS.map((c) => (
                <option key={c} value={c}>
                  최근 {c}개
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={load}
            disabled={busy || picked.size === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-45"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            {series ? "다시 불러오기" : "수치 불러오기"}
          </button>
        </div>

        <ul className="mt-3 grid gap-x-5 gap-y-1.5 border-t border-border pt-3 sm:grid-cols-2">
          {usable.map((t) => {
            const k = `${t.orgId}-${t.tblId}`;
            return (
              <li key={k}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-3.5 shrink-0 accent-[var(--primary)]"
                    checked={picked.has(k)}
                    onChange={() => toggle(k)}
                  />
                  <span>
                    {t.label}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {[t.survey, coverage(t), t.tblId].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-xs text-muted-foreground">
          기본값인 <strong>표별 수록주기</strong>는 통계표마다 DB에 저장된 그 표의 주기로
          부릅니다. 연간·분기·월간이 섞여 있어 하나로 강제하면 절반이 빈 결과가 됩니다. 특정
          주기를 고르면 그 주기를 수록하지 않는 표는 수록된 주기로 대체해 부르고, 무엇으로
          불렀는지 카드에 적습니다. KOSIS 는 분당 200회 제한이 있어 한 번에 최대 16개까지
          부릅니다.
        </p>
      </div>

      {err && (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {err}
        </p>
      )}

      {/* 카드 */}
      {ok.length > 0 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {ok.map((s) => {
            const pts = s.points;
            const last = pts[pts.length - 1];
            const prev = pts.length > 1 ? pts[pts.length - 2] : null;
            const diff =
              last?.value != null && prev?.value != null ? last.value - prev.value : null;
            const max = Math.max(...pts.map((p) => Math.abs(p.value ?? 0)), 1);
            const url = kosisTableUrl(s.orgId, s.tblId);

            return (
              <article key={`${s.orgId}-${s.tblId}`} className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-bold leading-snug">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-start gap-1 hover:text-primary hover:underline"
                    >
                      {s.tableName ?? labelOf(`${s.orgId}-${s.tblId}`) ?? s.tblId}
                      <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    (s.tableName ?? labelOf(`${s.orgId}-${s.tblId}`) ?? s.tblId)
                  )}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  계열 <span className="font-medium text-foreground/75">{s.seriesName}</span>
                  {s.seriesTotal > 1 && ` · 응답 ${s.seriesTotal}개 계열 중 총계에 가장 가까운 하나`}
                </p>
                {s.seriesNote && (
                  <p className="mt-0.5 text-xs text-amber-700">{s.seriesNote}</p>
                )}
                {s.dims.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    분류 {s.dims.map((d) => `${d.name}=${d.chosenName}`).join(" · ")}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  주기 {PRD_LABEL[s.prdSeUsed] ?? s.prdSeUsed}
                  {prdSe !== "auto" && s.prdSeUsed !== prdSe && (
                    <span className="text-amber-700">
                      {" "}
                      — {PERIOD_LABEL[prdSe]} 미수록이라 대체했습니다
                    </span>
                  )}
                </p>

                <div className="mt-3 flex items-baseline gap-2">
                  {/* 원래 표기가 있으면 그걸 씁니다. "9시간 24분" 을 564 로 보여 주면 안 됩니다. */}
                  <span className="text-3xl font-bold tabular-nums">
                    {last?.text ?? fmt(last?.value ?? null)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {last?.text ? "" : (s.unit ?? "")}
                  </span>
                  {last && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatPeriod(last.period, prdSe)}
                    </span>
                  )}
                </div>
                {diff !== null && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    직전 시점 대비 {diff > 0 ? "+" : ""}
                    {fmt(diff)} {s.isDuration ? "분" : (s.unit ?? "")}
                  </p>
                )}

                <ul className="mt-3 space-y-1 border-t border-border pt-3">
                  {pts.map((p) => (
                    <li key={p.period} className="flex items-center gap-2 text-xs">
                      <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                        {formatPeriod(p.period, prdSe)}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.round((Math.abs(p.value ?? 0) / max) * 100)}%` }}
                        />
                      </span>
                      <span className="w-24 shrink-0 text-right tabular-nums">
                        {p.text ?? fmt(p.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}

      {ok.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs leading-6 text-amber-950">
          <strong>시점을 이어 볼 때</strong> — 조사에는 표본·모집단·분류체계 개편이 있습니다. 개편
          전후는 정의가 달라 하나의 시계열로 해석하면 안 되는 구간이 생깁니다. 위 막대는 KOSIS
          원본 값을 그대로 늘어놓은 것일 뿐 개편 여부를 판정하지 않습니다. 증감을 인용하실 때는
          해당 통계표의 조사연혁을 확인하세요.
          <br />
          출처: 국가통계포털(KOSIS) · 각 카드 제목이 원 통계표로 연결됩니다.
        </div>
      )}

      {bad.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {bad.map((s) => (
            <li key={`${s.orgId}-${s.tblId}`}>
              {/* 실패한 것도 사람이 읽는 이름으로 보여 줍니다.
                  DT_1SSHE020R 만 적혀 있으면 어느 표가 빠졌는지 알 수 없습니다.
                  KOSIS 가 통계표명을 안 준 경우(=호출 자체가 실패)라 우리 목록에서 찾습니다. */}
              <span className="font-medium text-foreground/80">
                {s.tableName ?? labelOf(`${s.orgId}-${s.tblId}`) ?? s.tblId}
              </span>
              <span className="ml-1.5 text-muted-foreground/70">{s.tblId}</span>
              <br />
              <span className="whitespace-pre-wrap break-all">{s.error}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
