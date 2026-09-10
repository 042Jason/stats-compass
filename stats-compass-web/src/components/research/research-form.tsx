"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEARCH_STEPS, STEP_MS } from "@/lib/search-steps";
import { SearchProgressGraph } from "./search-progress-graph";

interface Props {
  stages: Array<{ key: string; label: string; description: string | null }>;
  samples: string[];
  initialQuery: string;
  initialStages: string[];
}

export function ResearchForm({ stages, samples, initialQuery, initialStages }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initialQuery);
  const [picked, setPicked] = useState<Set<string>>(new Set(initialStages));
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);

  /**
   * 지금 화면에 뜬 결과와 조건이 다른가.
   *
   * 예전에는 생애단계를 누르는 즉시 다시 검색했습니다. 그런데 둘·셋을 고르려면
   * 그때마다 검색이 돌아 화면이 흔들리고, 원치 않는 조합으로 한 번씩 검색됩니다.
   * 조건을 다 고른 뒤 <찾기>를 누르게 하고, 그 사이에는 "바뀌었다"고만 알립니다.
   */
  const same =
    q.trim() === initialQuery.trim() &&
    picked.size === initialStages.length &&
    initialStages.every((k) => picked.has(k));
  const dirty = !same && initialQuery.trim() !== "";

  const submit = (question: string, stageSet: Set<string>) => {
    const next = new URLSearchParams(params.toString());
    if (question.trim()) next.set("q", question.trim());
    else next.delete("q");
    if (stageSet.size > 0) next.set("stage", [...stageSet].join(","));
    else next.delete("stage");

    // 단계 문구를 넘깁니다. 실제 진행률이 아니라 <무슨 일이 일어나는지>를 알리는 용도입니다.
    setStep(0);
    const timers = SEARCH_STEPS.map((_, i) => setTimeout(() => setStep(i), STEP_MS * i));
    startTransition(() => {
      router.push(`/research?${next.toString()}`);
    });
    setTimeout(() => timers.forEach(clearTimeout), STEP_MS * SEARCH_STEPS.length + 500);
  };

  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
    // 여기서 검색하지 않습니다. <찾기>를 눌러야 반영됩니다.
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(q, picked);
        }}
        className="flex gap-2"
      >
        <label htmlFor="rag-q" className="sr-only">
          연구 질문
        </label>
        <input
          id="rag-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="예: 결혼한 뒤 가구 소득은 어떻게 달라지나요?"
          className="h-12 flex-1 rounded-lg border border-border bg-background px-4 text-[15px] text-foreground outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={pending}
          className={cn(
            "inline-flex h-12 items-center gap-2 rounded-lg px-5 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60",
            dirty ? "bg-primary ring-2 ring-primary/30 ring-offset-2" : "bg-primary",
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          {pending ? "찾는 중" : dirty ? "다시 찾기" : "찾기"}
        </button>
      </form>

      {/* 진행 표시 — 단계 설명과 그래프가 같은 step 으로 함께 움직입니다 */}
      {pending && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-primary/25 bg-primary-soft/50 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {SEARCH_STEPS[step]?.caption}
          </div>

          <SearchProgressGraph step={step} />

          <p className="text-xs text-muted-foreground">
            질문마다 임베딩 1회와 그래프 조회 1회가 나갑니다. 보통 2~5초 걸립니다.
          </p>
        </div>
      )}

      <fieldset disabled={pending}>
        <legend className="mb-2 text-sm font-medium text-muted-foreground">
          생애단계로 좁히기 (선택)
        </legend>
        <div className="flex flex-wrap gap-2">
          {stages.map((s) => {
            const on = picked.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                aria-pressed={on}
                title={s.description ?? undefined}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {dirty && !pending && (
          <p className="mt-2 text-sm font-medium text-primary">
            조건이 바뀌었습니다 — <strong>다시 찾기</strong>를 눌러야 반영됩니다.
          </p>
        )}
      </fieldset>

      {samples.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">이런 질문:</span>
          {samples.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() => {
                // 예시 질문은 고르는 즉시 검색합니다. 한 번 누르면 끝나는 동작이라
                // 여기서 또 <찾기>를 요구하면 번거롭기만 합니다.
                setQ(s);
                submit(s, picked);
              }}
              className="rounded-md border border-dashed border-border px-2.5 py-1 text-left text-xs text-foreground/80 hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
