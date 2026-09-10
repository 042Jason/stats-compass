import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // text-foreground 를 반드시 박아야 합니다.
        // Tailwind preflight 가 input 에 color:inherit 을 걸기 때문에, 히어로처럼
        // text-primary-foreground(흰색) 인 영역 안에 놓이면 흰 바탕에 흰 글씨가 됩니다.
        // 배경을 bg-background 로 고정했으면 글자색도 같이 고정해야 짝이 맞습니다.
        "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
