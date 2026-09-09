import { cn } from "@/lib/utils";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, children, className }: PageHeaderProps) {
  return (
    <div className={cn("border-b border-border bg-muted/40", className)}>
      <div className="container-page py-10 md:py-12">
        {eyebrow && <p className="mb-2 text-sm font-semibold text-primary">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        {description && <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">{description}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}
