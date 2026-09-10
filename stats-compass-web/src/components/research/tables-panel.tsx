"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, Sparkles, Table2 } from "lucide-react";
import { kosisTableUrl, type RagTable } from "@/lib/graphrag";
import { KosisDashboard } from "./kosis-dashboard";

/**
 * 통계표 목록과 수치 대시보드를 한 덩어리로 묶습니다.
 *
 * 둘을 따로 두면 순서가 어긋납니다. 목록에서 두 번째로 본 표가 아래 수치에서는
 * 다섯 번째에 있으면 눈이 계속 왔다 갔다 합니다. 한 컴포넌트가 순서를 쥐고
 * 양쪽에 같은 배열을 내려 줍니다.
 *
 * ── 검색 알고리즘은 그대로입니다
 * 무엇을 찾을지는 GraphRAG 가 이미 정했습니다. 여기서 바뀌는 건 <순서뿐>이고,
 * 서버가 순열이 아닌 답을 주면 통째로 버립니다. 표가 늘거나 줄지 않습니다.
 * 검색 순서로 되돌리는 버튼도 항상 열어 둡니다.
 */

interface Rank {
  order: number[];
  reasons: Record<number, string>;
  focus: string | null;
}

export function TablesPanel({ question, tables }: { question: string; tables: RagTable[] }) {
  const [rank, setRank] = useState<Rank | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // StrictMode 가 effect 를 두 번 돌려 LLM 을 두 번 부르는 것을 막습니다.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || tables.length < 2) return;
    fired.current = true;

    let alive = true;
    void (async () => {
      setBusy(true);
      try {
        const res = await fetch("/api/rank-tables", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question,
            // 정렬에 필요한 것만 보냅니다. 점수·랭크는 모델이 볼 이유가 없습니다.
            tables: tables.map((t) => ({
              label: t.label,
              survey: t.survey,
              tblId: t.tblId,
              orgId: t.orgId,
              firstPeriod: t.firstPeriod,
              latestPeriod: t.latestPeriod,
              directHit: t.directHit,
            })),
          }),
        });
        const json = (await res.json()) as Partial<Rank> & { error?: string | null };
        if (!alive) return;
        if (json.error) setErr(json.error);
        if (Array.isArray(json.order) && json.order.length === tables.length) {
          setRank({ order: json.order, reasons: json.reasons ?? {}, focus: json.focus ?? null });
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setBusy(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 화면에 실제로 쓸 순서. AI 순서를 끄면 검색 순서 그대로입니다. */
  const view = useMemo(() => {
    if (!rank || !useAi) return tables.map((t, i) => ({ t, origin: i }));
    return rank.order.map((i) => ({ t: tables[i], origin: i })).filter((x) => Boolean(x.t));
  }, [rank, useAi, tables]);

  const ordered = useMemo(() => view.map((v) => v.t), [view]);

  /**
   * 대시보드를 다시 마운트할지 정하는 열쇠.
   *
   * <정렬>이 아니라 <구성>이 바뀔 때만 바뀌어야 합니다. 순서만 바뀌었는데
   * 새로 마운트되면 이미 불러온 수치와 체크박스 선택이 통째로 날아갑니다.
   */
  const setKey = useMemo(
    () => [...tables.map((t) => t.tblId ?? "")].sort().join(","),
    [tables],
  );

  if (tables.length === 0) return null;

  return (
    <>
      <section aria-labelledby="tables">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="tables" className="flex items-center gap-2 text-lg font-bold">
            <Table2 className="size-5 text-primary" aria-hidden />
            바로 볼 만한 통계표
          </h2>

          {busy && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              질문에 맞춰 순서를 다시 매기는 중…
            </span>
          )}

          {rank && (
            <button
              type="button"
              onClick={() => setUseAi((v) => !v)}
              className={[
                "ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition",
                useAi
                  ? "border-primary/30 bg-primary-soft text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              ].join(" ")}
              aria-pressed={useAi}
            >
              <Sparkles className="size-3" aria-hidden />
              {useAi ? "AI 정렬 켜짐 — 검색 순서로 보기" : "AI 정렬 꺼짐 — 질문에 맞춰 정렬"}
            </button>
          )}
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          찾아낸 표는 <strong>검색이 정합니다</strong>. AI 는 그 목록을 넣거나 빼지 않고{" "}
          <strong>순서만</strong> 질문에 맞게 다시 매깁니다. 아래 수치 카드도 같은 순서를 씁니다.
        </p>

        {rank?.focus && useAi && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary-soft/50 px-2.5 py-1 text-xs text-primary">
            <Sparkles className="size-3" aria-hidden />
            읽어낸 초점 — {rank.focus}
          </p>
        )}

        {err && (
          <p className="mt-2 text-xs text-muted-foreground">
            순서 재정렬을 건너뛰었습니다 ({err}). 검색 순서 그대로 보여 드립니다.
          </p>
        )}

        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">질문과 가까운 KOSIS 통계표</caption>
            <thead className="bg-muted/60">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5 text-center font-semibold">
                  순
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">통계표</th>
                <th scope="col" className="w-40 px-4 py-2.5 font-semibold">조사</th>
                <th scope="col" className="w-28 px-4 py-2.5 font-semibold">최신 시점</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {view.map(({ t, origin }, i) => {
                const url = kosisTableUrl(t.orgId, t.tblId);
                const why = useAi ? rank?.reasons[origin] : undefined;
                const moved = useAi && rank ? origin - i : 0;
                return (
                  <tr key={`${t.tblId ?? t.label}-${origin}`} className="align-top">
                    <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="px-4 py-2.5">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-start gap-1 hover:text-primary hover:underline"
                        >
                          {t.label}
                          <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
                        </a>
                      ) : (
                        t.label
                      )}
                      {why && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-primary/80">
                          <Sparkles className="size-3 shrink-0" aria-hidden />
                          {why}
                          {moved > 0 && (
                            <span className="text-muted-foreground">
                              (검색 {origin + 1}위 → {i + 1}위)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {t.survey ?? "—"}
                      {t.directHit ? (
                        <span className="ml-1.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          질문에 직접
                        </span>
                      ) : t.rank === 1 ? (
                        <span className="ml-1.5 rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          대표
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {t.latestPeriod ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <KosisDashboard key={setKey} tables={ordered} />
    </>
  );
}
