import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  href?: string;
  label: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="현재 위치" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link href="/" className="hover:text-primary hover:underline">
            홈
          </Link>
        </li>
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            <ChevronRight className="size-3.5" aria-hidden />
            {c.href ? (
              <Link href={c.href} className="hover:text-primary hover:underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
