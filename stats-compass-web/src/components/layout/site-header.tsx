import Link from "next/link";
import { Compass } from "lucide-react";
import { SITE_NAME, NAV_ITEMS } from "@/lib/constants";
import { MainNav } from "./main-nav";
import { HeaderSearch } from "@/components/search/header-search";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        본문 바로가기
      </a>
      <div className="container-page flex h-16 items-center gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`${SITE_NAME} 홈`}>
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Compass className="size-5" aria-hidden />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-tight text-primary">{SITE_NAME}</span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">국가승인통계 안내</span>
          </span>
        </Link>

        <nav aria-label="주요 메뉴" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-primary"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto hidden w-full max-w-xs md:block">
          <HeaderSearch />
        </div>

        <MainNav items={NAV_ITEMS} />
      </div>
    </header>
  );
}
