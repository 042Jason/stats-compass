"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, Maximize2, Minimize2, X } from "lucide-react";
import type { DeckSlide } from "@/lib/deck";

/**
 * 발표용 장표 뷰어.
 *
 * 한 번에 한 장. 화살표·스페이스·PageUp/Down 으로 넘깁니다. 발표석에서 마우스를
 * 찾을 일이 없어야 하므로 키보드를 먼저 맞췄습니다.
 *
 * 전체화면은 Fullscreen API 를 씁니다. 사이트 헤더까지 덮어야 발표 화면이 됩니다.
 * 브라우저가 막으면(허용 안 됨) 그냥 조용히 넘어갑니다 — 전체화면이 아니어도
 * 장표는 그대로 동작합니다.
 */

export function DeckViewer({ slides }: { slides: DeckSlide[] }) {
  const [i, setI] = useState(0);
  const [grid, setGrid] = useState(false);
  const [full, setFull] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const n = slides.length;
  const go = useCallback(
    (next: number) => setI((cur) => Math.min(n - 1, Math.max(0, typeof next === "number" ? next : cur))),
    [n],
  );

  const toggleFull = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 입력창에 타이핑 중이면 장표를 넘기지 않습니다.
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
          e.preventDefault();
          setGrid(false);
          setI((c) => Math.min(n - 1, c + 1));
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          setGrid(false);
          setI((c) => Math.max(0, c - 1));
          break;
        case "Home":
          e.preventDefault();
          setI(0);
          break;
        case "End":
          e.preventDefault();
          setI(n - 1);
          break;
        case "o":
        case "O":
          setGrid((g) => !g);
          break;
        case "f":
        case "F":
          toggleFull();
          break;
        case "Escape":
          setGrid(false);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, toggleFull]);

  const s = slides[i];
  if (!s) return null;

  const cover = s.tone === "cover";

  return (
    <div
      ref={rootRef}
      className={[
        "relative flex flex-col overflow-hidden rounded-xl border border-border",
        full ? "h-screen rounded-none border-0" : "h-[calc(100vh-9rem)] min-h-[540px]",
        cover ? "bg-primary text-primary-foreground" : "bg-card",
      ].join(" ")}
    >
      {/* 진행 막대 */}
      <div className={cover ? "h-1 w-full bg-white/20" : "h-1 w-full bg-muted"}>
        <div
          className={["h-full transition-all duration-300", cover ? "bg-white/80" : "bg-primary"].join(" ")}
          style={{ width: `${((i + 1) / n) * 100}%` }}
        />
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto px-8 py-8 sm:px-14 sm:py-12">
        {grid ? (
          <Overview slides={slides} current={i} onPick={(k) => { go(k); setGrid(false); }} />
        ) : (
          <Slide s={s} />
        )}
      </div>

      {/* 아래 조작줄 */}
      <div
        className={[
          "flex items-center gap-2 border-t px-4 py-2.5 text-sm",
          cover ? "border-white/20" : "border-border",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => setGrid((g) => !g)}
          className={ctl(cover)}
          aria-label="장표 목록"
        >
          {grid ? <X className="size-4" aria-hidden /> : <LayoutGrid className="size-4" aria-hidden />}
          <span className="hidden sm:inline">{grid ? "닫기" : "목록"}</span>
        </button>

        <span className={cover ? "text-xs text-white/70" : "text-xs text-muted-foreground"}>
          <span className="hidden md:inline">← → 넘기기 · O 목록 · F 전체화면 · </span>
          <span className="tabular-nums font-semibold">{i + 1}</span> / {n}
        </span>

        <button type="button" onClick={toggleFull} className={[ctl(cover), "ml-auto"].join(" ")} aria-label="전체화면">
          {full ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          <span className="hidden sm:inline">{full ? "나가기" : "전체화면"}</span>
        </button>

        <button
          type="button"
          onClick={() => { setGrid(false); go(i - 1); }}
          disabled={i === 0}
          className={ctl(cover)}
          aria-label="이전 장"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => { setGrid(false); go(i + 1); }}
          disabled={i === n - 1}
          className={ctl(cover)}
          aria-label="다음 장"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function ctl(cover: boolean): string {
  return [
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-35",
    cover
      ? "border-white/25 text-primary-foreground hover:bg-white/10"
      : "border-border bg-card hover:bg-muted",
  ].join(" ");
}

/* ───────────────────────── 한 장 ───────────────────────── */

function Slide({ s }: { s: DeckSlide }) {
  const cover = s.tone === "cover";
  const sub = cover ? "text-primary-foreground/80" : "text-muted-foreground";

  return (
    <article className="mx-auto flex h-full max-w-4xl flex-col">
      <p className={["text-xs font-semibold tracking-wide", cover ? "text-primary-foreground/70" : "text-primary"].join(" ")}>
        {s.kicker}
      </p>

      <h2
        className={[
          "mt-2 font-bold leading-tight",
          cover ? "text-4xl sm:text-5xl" : "text-2xl sm:text-3xl",
        ].join(" ")}
      >
        {s.title}
      </h2>

      {s.lead && <p className={["mt-4 max-w-3xl text-[15px] leading-7 sm:text-base", sub].join(" ")}>{s.lead}</p>}

      {s.stats && (
        <dl className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {s.stats.map((st) => (
            <div
              key={st.label}
              className={[
                "rounded-xl border p-4",
                cover ? "border-white/20 bg-white/10" : "border-border bg-muted/40",
              ].join(" ")}
            >
              <dt className={["text-xs", sub].join(" ")}>{st.label}</dt>
              <dd className="mt-1 text-2xl font-bold tabular-nums sm:text-3xl">{st.value}</dd>
              {st.note && <p className={["mt-1 text-[11px] leading-4", sub].join(" ")}>{st.note}</p>}
            </div>
          ))}
        </dl>
      )}

      {s.versus && (
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <Column cover={cover} title={s.versus.leftTitle} items={s.versus.left} accent />
          <Column cover={cover} title={s.versus.rightTitle} items={s.versus.right} />
        </div>
      )}

      {s.flow && (
        <ol className="mt-7 space-y-3">
          {s.flow.map((f, k) => (
            <li
              key={f.step}
              className={[
                "flex gap-4 rounded-xl border p-4",
                cover ? "border-white/20 bg-white/10" : "border-border bg-muted/30",
              ].join(" ")}
            >
              <span
                className={[
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                  cover ? "bg-white/20" : "bg-primary text-primary-foreground",
                ].join(" ")}
              >
                {k + 1}
              </span>
              <div>
                <p className="text-sm font-bold">{f.step}</p>
                <p className={["mt-0.5 text-sm leading-6", sub].join(" ")}>{f.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {s.bullets && (
        <ul className="mt-7 space-y-2.5">
          {s.bullets.map((b) => (
            <li key={b} className="flex gap-3 text-[15px] leading-7">
              <span className={["mt-2.5 size-1.5 shrink-0 rounded-full", cover ? "bg-white/60" : "bg-primary"].join(" ")} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {s.note && (
        <p
          className={[
            "mt-auto border-t pt-4 text-xs leading-6",
            cover ? "border-white/20 text-primary-foreground/70" : "border-border text-muted-foreground",
          ].join(" ")}
        >
          {s.note}
        </p>
      )}
    </article>
  );
}

function Column({
  cover,
  title,
  items,
  accent = false,
}: {
  cover: boolean;
  title: string;
  items: string[];
  accent?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-xl border p-5",
        cover
          ? "border-white/20 bg-white/10"
          : accent
            ? "border-primary/25 bg-primary-soft/50"
            : "border-border bg-muted/30",
      ].join(" ")}
    >
      <p
        className={[
          "text-xs font-bold",
          cover ? "text-primary-foreground/75" : accent ? "text-primary" : "text-muted-foreground",
        ].join(" ")}
      >
        {title}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((t) => (
          <li key={t} className="text-sm leading-6">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────── 목록 ───────────────────────── */

function Overview({
  slides,
  current,
  onPick,
}: {
  slides: DeckSlide[];
  current: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="text-sm font-semibold text-muted-foreground">장표 목록</h2>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {slides.map((s, k) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onPick(k)}
              className={[
                "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition",
                k === current
                  ? "border-primary/40 bg-primary-soft/60"
                  : "border-border bg-card hover:bg-muted",
              ].join(" ")}
            >
              <span className="mt-0.5 w-6 shrink-0 text-xs font-bold tabular-nums text-muted-foreground">
                {String(k + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="block text-sm font-semibold leading-snug">{s.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{s.kicker}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
