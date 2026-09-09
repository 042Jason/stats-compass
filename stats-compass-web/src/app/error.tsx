"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/shared/error-state";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-page py-16">
      <ErrorState
        title="문제가 발생했습니다"
        description="페이지를 표시하는 중 오류가 발생했습니다. 다시 시도하거나 홈으로 이동해 주세요."
        detail={error.message}
      />
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={reset}>다시 시도</Button>
        <Button asChild variant="outline">
          <Link href="/">홈으로</Link>
        </Button>
      </div>
    </div>
  );
}
