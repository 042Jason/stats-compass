"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { RagResult } from "@/lib/graphrag";
import type { ResolvedSlots } from "@/lib/slots";

/**
 * 검색 결과를 컨텍스트로 삼은 LLM 길잡이.
 *
 * 검색과 따로 부릅니다. 검색은 1~2초, LLM 은 5~10초라 한 요청으로 묶으면
 * 결과 목록 전체가 LLM 을 기다립니다. 목록이 먼저 뜨고 길잡이가 따라옵니다.
 *
 * 이 글은 <수치를 말하지 않습니다>. 어느 조사를 어떤 순서로 보고 무엇을 조심할지만
 * 씁니다. 숫자는 아래 "수치로 보기" 카드가 KOSIS 원본 그대로 보여 줍니다.
 */

/** 아주 작은 마크다운 렌더러 — **굵게** 와 - 불릿만 다룹니다. */
function render(md: string): React.ReactNode {
  const blocks = md.split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split("\n");
    const isList = lines.every((l) => /^\s*[-*]\s+/.test(l));
    if (isList) {
      return (
        <ul key={bi} className="my-2 list-disc space-y-1 pl-5">
          {lines.map((l, i) => (
            <li key={i}>{bold(l.replace(/^\s*[-*]\s+/, ""))}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={bi} className="my-2 leading-7">
        {lines.map((l, i) => (
          <span key={i}>
            {bold(l)}
            {i < lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}

function bold(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function AiBriefing({
  question,
  slots,
  result,
}: {
  question: string;
  slots: ResolvedSlots;
  result: RagResult;
}) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 개발 중 StrictMode 가 effect 를 두 번 돌려 LLM 을 두 번 부르는 것을 막습니다.
  const fired = useRef(false);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, slots, result }),
      });
      const json = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `요청 실패 (${res.status})`);
      setText(json.text ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (result.surveys.length === 0) return null;

  return (
    <section aria-labelledby="briefing" className="rounded-xl border border-primary/25 bg-primary-soft/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="briefing" className="flex items-center gap-2 text-lg font-bold text-primary">
          <Sparkles className="size-5" aria-hidden />
          이렇게 보시면 됩니다
        </h2>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-45"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />}
          다시 쓰기
        </button>
      </div>

      {busy && !text && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          검색 결과를 읽고 정리하는 중…
        </p>
      )}

      {err && (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {err}
        </p>
      )}

      {text && <div className="mt-2 text-[15px] text-foreground/90">{render(text)}</div>}

      {text && (
        <p className="mt-3 border-t border-primary/15 pt-3 text-xs leading-6 text-muted-foreground">
          이 글은 <strong>위 검색 결과만</strong> 읽고 쓴 길잡이입니다. 수치는 말하지 않습니다 —
          숫자는 아래 <strong>수치로 보기</strong>가 KOSIS 원본 그대로 보여 줍니다. 생성형 AI 특성상
          표현이 어긋날 수 있으니 인용 전에 원 통계표를 확인하세요.
        </p>
      )}
    </section>
  );
}
