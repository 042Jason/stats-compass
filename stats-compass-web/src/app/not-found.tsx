import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-page flex flex-col items-center py-24 text-center">
      <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <SearchX className="size-7" aria-hidden />
      </span>
      <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        요청하신 주소가 잘못되었거나, 해당 조사·세트가 아직 등록되지 않았을 수 있습니다.
      </p>
      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link href="/">홈으로</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/browse">조사 찾기</Link>
        </Button>
      </div>
    </div>
  );
}
