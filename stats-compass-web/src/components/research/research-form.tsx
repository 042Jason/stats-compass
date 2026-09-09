"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

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

  const submit = (question: string, stageSet: Set<string>) => {
    const next = new URLSearchParams(params.toString());
    if (question.trim()) next.set("q", question.trim());
    else next.delete("q");
    if (stageSet.size > 0) next.set("stage", [...stageSet].join(","));
    else next.delete("stage");
    router.push(`/research?${next.toString()}`);
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
          className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-5 font-medium text-primary-foreground hover:opacity-90"
        >
          <Search className="size-4" aria-hidden />
          찾기
        </button>
      </form>

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
