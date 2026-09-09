import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface SectionHeaderProps {
  title: string;
  description?: string;
  moreHref?: string;
  moreLabel?: string;
  as?: "h2" | "h3";
  id?: string;
}

export function SectionHeader({ title, description, moreHref, moreLabel = "더 보기", as: Tag = "h2", id }: SectionHeaderProps) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <Tag id={id} className="text-xl font-bold tracking-tight md:text-2xl">{title}</Tag>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {moreHref && (
        <Link
          href={moreHref}
          className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary hover:underline"
        >
          {moreLabel}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}
