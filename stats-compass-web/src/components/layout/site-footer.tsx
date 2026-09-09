import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { KOSIS_HOME, NAV_ITEMS, SITE_NAME } from "@/lib/constants";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-muted/40">
      <div className="container-page grid gap-8 py-12 md:grid-cols-3">
        <div className="md:col-span-1">
          <p className="text-base font-bold text-primary">{SITE_NAME}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            국가데이터처(구 통계청) 승인통계를 찾고 이해하기 쉽게 안내하는 큐레이션 서비스입니다.
            통계 원자료와 최신 수치는 KOSIS 국가통계포털에서 확인하실 수 있습니다.
          </p>
        </div>

        <nav aria-label="바닥글 메뉴" className="text-sm">
          <p className="mb-3 font-semibold">둘러보기</p>
          <ul className="space-y-2">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted-foreground hover:text-primary hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/search" className="text-muted-foreground hover:text-primary hover:underline">
                통합 검색
              </Link>
            </li>
          </ul>
        </nav>

        <div className="text-sm">
          <p className="mb-3 font-semibold">관련 사이트</p>
          <ul className="space-y-2">
            <li>
              <a
                href={KOSIS_HOME}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary hover:underline"
              >
                KOSIS 국가통계포털 <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(새 창)</span>
              </a>
            </li>
            <li>
              <a
                href="https://www.data.go.kr"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary hover:underline"
              >
                공공데이터포털 <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(새 창)</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="container-page flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>본 서비스의 통계 메타정보는 KOSIS OpenAPI를 바탕으로 정리되었으며, 원 출처의 표기를 우선합니다.</p>
          <p>© {new Date().getFullYear()} {SITE_NAME}</p>
        </div>
      </div>
    </footer>
  );
}
