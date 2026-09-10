import Link from "next/link";
import { getCategoryMeta } from "@/lib/categories";
import { cn } from "@/lib/utils";

interface CategoryBadgeProps {
  category: string | null | undefined;
  /** true 면 /browse?category= 링크로 */
  linked?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function CategoryBadge({ category, linked = false, size = "sm", className }: CategoryBadgeProps) {
  const meta = getCategoryMeta(category);
  const Icon = meta.icon;
  const cls = cn(
    "inline-flex w-fit items-center gap-1 rounded-md font-medium",
    size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
    meta.tone,
    linked && "transition hover:brightness-95 hover:underline",
    className,
  );
  const content = (
    <>
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
      {meta.label}
    </>
  );
  if (linked && category) {
    return (
      <Link href={`/browse?category=${encodeURIComponent(category)}`} className={cls} aria-label={`${meta.label} 분야 통계 보기`}>
        {content}
      </Link>
    );
  }
  return <span className={cls}>{content}</span>;
}
