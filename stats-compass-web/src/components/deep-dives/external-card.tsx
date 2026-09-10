"use client";

import { useState } from "react";
import { ArrowUpRight, Compass, ExternalLink } from "lucide-react";
import type { ExternalDeepDive } from "@/lib/external-deep-dives";

/**
 * 외부 Deep Dive 카드.
 *
 * 클라이언트 컴포넌트인 이유는 하나뿐입니다 — 커버 이미지가 아직 없을 때
 * onError 로 대체 커버를 띄우기 위해서입니다. 서버에서 파일 존재를 확인하면
 * 빌드 시점과 배포 시점이 어긋날 때 깨진 이미지가 그대로 나갑니다.
 *
 * next/image 를 쓰지 않았습니다. 최적화 대상이 캡쳐 한 장뿐이고, 파일이
 * 없을 때 next/image 는 onError 이전에 서버에서 먼저 실패합니다.
 */
export function ExternalDeepDiveCard({ item }: { item: ExternalDeepDive }) {
  const [broken, setBroken] = useState(false);

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40 hover:shadow-[0_4px_16px_rgba(0,56,118,0.10)]"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-border bg-primary-soft/40">
        {broken ? (
          <FallbackCover title={item.title} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.cover}
            alt={item.coverAlt}
            loading="lazy"
            onError={() => setBroken(true)}
            className="size-full object-cover object-top transition duration-300 group-hover:scale-[1.02]"
          />
        )}
        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-[11px] font-semibold text-primary shadow-sm backdrop-blur">
          <ExternalLink className="size-3" aria-hidden /> 외부 링크
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <Compass className="size-3.5" aria-hidden /> Deep Dive · {item.publisher}
        </p>

        <div>
          <h2 className="text-lg font-bold leading-snug group-hover:text-primary">{item.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{item.subtitle}</p>
        </div>

        <p className="line-clamp-4 text-sm leading-6 text-foreground/80">{item.summary}</p>

        <ul className="flex flex-wrap gap-1.5" role="list">
          {item.tags.map((t) => (
            <li
              key={t}
              className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {t}
            </li>
          ))}
        </ul>

        <p className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-semibold text-primary">
          새 창으로 열기
          <ArrowUpRight className="size-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
        </p>
      </div>
    </a>
  );
}

/** 캡쳐 파일이 아직 없을 때. 빈 네모 대신 제목이라도 읽히게 둡니다. */
function FallbackCover({ title }: { title: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,var(--color-primary-soft),transparent)] px-6 text-center">
      <Compass className="size-8 text-primary/70" aria-hidden />
      <span className="text-sm font-bold text-primary/80">{title}</span>
      <span className="text-[11px] text-muted-foreground">미리보기 이미지 준비 중</span>
    </div>
  );
}
