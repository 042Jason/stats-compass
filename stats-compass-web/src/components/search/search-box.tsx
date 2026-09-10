"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchBoxProps {
  size?: "sm" | "lg";
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * 검색창 — 제출 시 /search?q= 로 이동 (URL 이 상태의 단일 원천).
 * useSearchParams 는 정적 렌더링 시 Suspense 경계가 필요하므로 내부에서 감쌉니다.
 */
export function SearchBox(props: SearchBoxProps) {
  return (
    <React.Suspense fallback={<SearchForm {...props} initial="" />}>
      <SearchBoxWithParams {...props} />
    </React.Suspense>
  );
}

function SearchBoxWithParams(props: SearchBoxProps) {
  const params = useSearchParams();
  return <SearchForm {...props} initial={params.get("q") ?? ""} />;
}

function SearchForm({ size = "lg", autoFocus, className, placeholder, initial }: SearchBoxProps & { initial: string }) {
  const router = useRouter();
  const [value, setValue] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setValue(initial);
  }, [initial]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    // startTransition 으로 감싸야 서버 렌더가 끝날 때까지 pending 이 유지됩니다.
    // 그냥 push 하면 버튼이 눌렸는지 알 길이 없습니다.
    startTransition(() => {
      router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
    });
  };

  const isLg = size === "lg";

  return (
    <form role="search" onSubmit={onSubmit} className={cn("relative flex w-full items-center", className)}>
      <label htmlFor={`search-${size}`} className="sr-only">
        통계 검색
      </label>
      <Search
        className={cn(
          "pointer-events-none absolute left-3 text-muted-foreground",
          isLg ? "size-5" : "size-4",
        )}
        aria-hidden
      />
      <Input
        id={`search-${size}`}
        name="q"
        type="search"
        inputMode="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? "조사명, 통계표명, 작성기관으로 검색"}
        className={cn(isLg ? "h-12 pl-11 pr-24 text-base" : "h-9 pl-9 pr-16 text-sm")}
      />
      <Button
        type="submit"
        size={isLg ? "default" : "sm"}
        disabled={pending}
        className={cn("absolute right-1.5", isLg ? "h-9" : "h-6 px-2.5")}
      >
        {pending ? <Loader2 className={cn("animate-spin", isLg ? "size-4" : "size-3")} aria-hidden /> : "검색"}
      </Button>
    </form>
  );
}
