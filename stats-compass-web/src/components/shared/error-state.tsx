import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: string;
  /** 개발 중 확인용 원인 메시지 (운영에서는 노출하지 않음) */
  detail?: string | null;
  className?: string;
  compact?: boolean;
}

export function ErrorState({
  title = "정보를 불러오지 못했습니다",
  description = "일시적인 문제일 수 있습니다. 잠시 후 다시 시도해 주세요.",
  detail,
  className,
  compact,
}: ErrorStateProps) {
  const showDetail = process.env.NODE_ENV !== "production" && detail;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50/60 text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className,
      )}
    >
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {showDetail && (
        <pre className="mt-4 max-w-full overflow-x-auto rounded-md bg-white/70 px-3 py-2 text-left text-xs text-amber-900">
          {detail}
        </pre>
      )}
    </div>
  );
}
