"use client";

import { usePathname } from "next/navigation";
import { SearchBox } from "./search-box";

/** 헤더 검색창 — 검색 페이지에서는 본문 검색창과 중복되므로 숨김 */
export function HeaderSearch() {
  const pathname = usePathname();
  if (pathname === "/search") return null;
  return <SearchBox size="sm" />;
}
