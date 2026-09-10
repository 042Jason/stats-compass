"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 검색 진행 표시.
 *
 * 이 검색은 서버에서 임베딩 1회 + DB 왕복 1회를 하느라 2~8초가 걸립니다.
 * 그동안 아무 반응이 없으면 사용자는 버튼이 안 눌린 줄 압니다.
 * router.push 를 startTransition 으로 감싸면 서버 렌더가 끝날 때까지 isPending 이 true 입니다.
 */
const STEPS = [
  "질문에서 나이·지역·성별을 떼어내는 중",
  "별칭과 본문으로 가까운 노드를 찾는 중 (어휘 + 벡터)",
  "온톨로지 관계를 타고 조사에 도달하는 중",
  "조사마다 대표 통계표를 고르는 중",
];

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

  const submit = (question: string, stageSet: Set<string>) => {
    const next = new URLSearchParams(params.toString());
    if (question.trim()) next.set("q", question.trim());
    else next.delete("q");
    if (stageSet.size > 0) next.set("stage", [...stageSet].join(","));
    else next.delete("stage");

    // 단계 문구를 1.2초 간격으로 넘깁니다. 실제 진행률이 아니라 <무슨 일이 일어나는지>를
    // 알려 주는 용도입니다. 가짜 진행률 막대보다 이쪽이 정직합니다.
    setStep(0);
    const timers = STEPS.map((_, i) => setTimeout(() => setStep(i), 1200 * i));
    startTransition(() => {
      router.push(`/research?${next.toString()}`);
    });
    setTimeout(() => timers.forEach(clearTimeout), 1200 * STEPS.length + 500);
  };

  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
    if (q.trim()) submit(q, next);
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
          className="h-12 flex-1 rounded-lg border border-border bg-background px-4 text-[15px] outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-5 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          {pending ? "찾는 중" : "찾기"}
        </button>
      </form>

      {/* 진행 표시 — 실제 진행률이 아니라 지금 무슨 일이 일어나는지를 알려 줍니다 */}
      {pending && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-primary/25 bg-primary-soft/50 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {STEPS[step]}
          </div>
          <ol className="mt-2 flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => (
              <li
                key={s}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-500",
                  i <= step ? "bg-primary" : "bg-primary/15",
                )}
                style={{ minWidth: 40 }}
              />
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            질문마다 임베딩 1회와 그래프 조회 1회가 나갑니다. 보통 2~5초 걸립니다.
          </p>
        </div>
      )}

      <fieldset>
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
      </fieldset>

      {samples.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">이런 질문:</span>
          {samples.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQ(s);
                submit(s, picked);
              }}
              className="rounded-md border border-dashed border-border px-2.5 py-1 text-left text-xs text-foreground/80 hover:border-primary/50 hover:text-primary"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
