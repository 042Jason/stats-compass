import Link from "next/link";
import { Inbox, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { href: string; label: string };
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-center",
        compact ? "px-4 py-8" : "px-6 py-16",
        className,
      )}
    >
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-base font-semibold">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}
      {action && (
        <Button asChild variant="outline" className="mt-5">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
