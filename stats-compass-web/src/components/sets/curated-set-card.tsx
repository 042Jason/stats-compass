import Link from "next/link";
import { BookMarked, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { CuratedSetRow } from "@/lib/types";
import { formatDate, truncate } from "@/lib/format";
import { pick } from "@/lib/normalize";
import { cn } from "@/lib/utils";

interface CuratedSetCardProps {
  set: CuratedSetRow;
  itemCount?: number;
  className?: string;
  featured?: boolean;
}

export function CuratedSetCard({ set, itemCount, className, featured }: CuratedSetCardProps) {
  const href = `/sets/${encodeURIComponent(set.slug)}`;
  const theme = pick<string>(set as Record<string, unknown>, ["theme", "topic", "subtitle", "eyebrow"]);
  const date = set.published_at ?? set.updated_at ?? set.created_at ?? null;
  const desc = truncate(set.description ?? pick<string>(set as Record<string, unknown>, ["summary", "intro"]) ?? "", featured ? 160 : 100);

  return (
    <Card
      className={cn(
        "group relative h-full gap-3 transition-shadow hover:shadow-[0_4px_16px_rgba(0,56,118,0.10)]",
        featured && "bg-gradient-to-br from-primary-soft/70 to-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        <BookMarked className="size-4" aria-hidden />
        {theme ?? "큐레이션 세트"}
      </div>
      <h3 className={cn("font-bold leading-snug", featured ? "text-xl" : "text-base")}>
        <Link href={href} className="after:absolute after:inset-0 after:content-[''] hover:text-primary">
          {set.title}
        </Link>
      </h3>
      {desc && <p className="text-sm leading-6 text-muted-foreground">{desc}</p>}
      <div className="mt-auto flex items-center justify-between pt-1 text-xs text-muted-foreground">
        <span>
          {typeof itemCount === "number" && <>{itemCount}개 조사</>}
          {typeof itemCount === "number" && date && " · "}
          {date && <time dateTime={date}>{formatDate(date, "short")}</time>}
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-primary">
          살펴보기 <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Card>
  );
}
