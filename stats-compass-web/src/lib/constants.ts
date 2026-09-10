export const SITE_NAME = "통계나침반";
export const SITE_TAGLINE = "국가승인통계, 한눈에 찾고 바르게 읽기";
export const SITE_DESCRIPTION =
  "국가데이터처(구 통계청) 승인통계를 주제별로 큐레이션하고, 각 통계의 목적·근거·통계표를 한곳에서 안내하는 공공서비스형 통계 안내 사이트입니다.";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

export const KOSIS_HOME = "https://kosis.kr";

/** 목록 페이지 기본 페이지 크기 */
export const PAGE_SIZE = 24;

export const NAV_ITEMS = [
  { href: "/research", label: "생애나침반" },
  { href: "/browse", label: "통계 찾기" },
  { href: "/sets", label: "큐레이션" },
  { href: "/whats-new", label: "What's New" },
  { href: "/deep-dives", label: "Deep Dive" },
  { href: "/graph", label: "관계망" },
  { href: "/deck", label: "발표 장표" },
] as const;
