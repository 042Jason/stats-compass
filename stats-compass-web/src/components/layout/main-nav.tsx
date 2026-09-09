"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchBox } from "@/components/search/search-box";

interface NavItem {
  href: string;
  label: string;
}

/** 모바일 전용 햄버거 메뉴 (md 미만에서 표시) */
export function MainNav({ items }: { items: readonly NavItem[] }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // 경로가 바뀌면 메뉴 닫기
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // ESC 로 닫기
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="ml-auto md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X /> : <Menu />}
      </Button>

      {open && (
        <div
          id="mobile-nav"
          className="absolute inset-x-0 top-16 border-b border-border bg-background p-4 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <SearchBox autoFocus />
          <nav aria-label="모바일 메뉴" className="mt-3 flex flex-col">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-3 py-3 text-base font-medium hover:bg-accent ${
                    active ? "bg-accent text-primary" : "text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </div>
  );
}
