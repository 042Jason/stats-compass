import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  totalPages: number;
  /** 현재 URL 의 나머지 쿼리 파라미터 */
  params: Record<string, string | undefined>;
  basePath: string;
}

function buildHref(basePath: string, params: Record<string, string | undefined>, page: number) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  if (page > 1) sp.set("page", String(page));
  else sp.delete("page");
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** 표시할 페이지 번호 계산 (1 … 4 5 [6] 7 8 … 20) */
function pageWindow(page: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, page, page - 1, page + 1, page - 2, page + 2]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

export function Pagination({ page, totalPages, params, basePath }: PaginationProps) {
  if (totalPages <= 1) return null;
  const items = pageWindow(page, totalPages);

  const linkCls =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border px-2 text-sm hover:bg-accent";

  return (
    <nav aria-label="페이지 이동" className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={buildHref(basePath, params, page - 1)} className={linkCls} aria-label="이전 페이지">
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(linkCls, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronLeft className="size-4" />
        </span>
      )}

      {items.map((it, i) =>
        it === "…" ? (
          <span key={`e${i}`} className="px-1 text-muted-foreground" aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={it}
            href={buildHref(basePath, params, it)}
            aria-current={it === page ? "page" : undefined}
            aria-label={`${it}페이지`}
            className={cn(linkCls, it === page && "border-primary bg-primary text-primary-foreground hover:bg-primary")}
          >
            {it}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link href={buildHref(basePath, params, page + 1)} className={linkCls} aria-label="다음 페이지">
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(linkCls, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
