"use client";

import { SEARCH_STEPS } from "@/lib/search-steps";

/**
 * 검색 중에 보여 주는 그래프 미리보기.
 *
 * 결과가 오기 전에는 진짜 노드가 없습니다. 그래도 <무엇이 무엇을 불러오는 구조인지>는
 * 미리 보여 줄 수 있습니다. 결과가 오면 같은 자리에 실제 이름이 채워지므로,
 * 기다리는 동안 본 그림과 결과 그림이 이어집니다.
 *
 * 진행률이 아니라 <순서>를 보여 주는 그림입니다. 막대가 몇 퍼센트 찼는지는
 * 알 수도 없고 알아도 쓸모가 없습니다.
 */

const VB_W = 640;
const VB_H = 96;
/** 열마다 점 몇 개를 그릴지. 실제 결과의 대략적인 모양입니다 */
const DOTS = [3, 4, 5, 3, 6];

const colX = (i: number) => 44 + i * ((VB_W - 88) / (SEARCH_STEPS.length - 1));
const dotY = (n: number, k: number) => {
  const top = 34;
  const span = VB_H - top - 14;
  return n === 1 ? top + span / 2 : top + (span * k) / (n - 1);
};

export function SearchProgressGraph({ step }: { step: number }) {
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="h-24 w-full"
      role="img"
      aria-label="검색 단계 진행"
    >
      {/* 선 — 앞 열이 켜진 뒤에 그어집니다 */}
      {SEARCH_STEPS.slice(0, -1).map((_, i) => {
        const on = i < step;
        const x1 = colX(i) + 6;
        const x2 = colX(i + 1) - 6;
        return DOTS[i] > 0 && DOTS[i + 1] > 0
          ? Array.from({ length: Math.min(DOTS[i], DOTS[i + 1]) }, (_, k) => {
              const y1 = dotY(DOTS[i], k);
              const y2 = dotY(DOTS[i + 1], k);
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={`${i}-${k}`}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={1}
                  opacity={on ? 0.28 : 0}
                  style={{ transition: "opacity .5s ease-out" }}
                />
              );
            })
          : null;
      })}

      {/* 열 머리글 + 점 */}
      {SEARCH_STEPS.map((s, i) => {
        const on = i <= step;
        return (
          <g key={s.title}>
            <text
              x={colX(i)}
              y={16}
              fontSize={10}
              fontWeight={700}
              textAnchor="middle"
              fill={on ? "var(--primary)" : "var(--muted-foreground)"}
              opacity={on ? 1 : 0.4}
              style={{ transition: "fill .4s, opacity .4s" }}
            >
              {s.title}
            </text>
            {Array.from({ length: DOTS[i] }, (_, k) => (
              <circle
                key={k}
                cx={colX(i)}
                cy={dotY(DOTS[i], k)}
                r={on ? 4 : 3}
                fill={on ? "var(--primary)" : "var(--muted-foreground)"}
                opacity={on ? 0.85 : 0.18}
                style={{
                  transition: "opacity .5s ease-out, r .4s ease-out",
                  // 같은 열 안에서도 살짝 시차를 둬 한꺼번에 켜지지 않게 합니다
                  transitionDelay: on ? `${k * 60}ms` : "0ms",
                }}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
