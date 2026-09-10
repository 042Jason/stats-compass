import type { Metadata } from "next";
import { DeckViewer } from "@/components/deck/deck-viewer";
import { buildDeck } from "@/lib/deck";
import { getDeckCounts } from "@/lib/queries/deck";

export const metadata: Metadata = {
  title: "발표 장표",
  description: "생애나침반이 무엇을 풀었고 어떻게 만들었는지 발표용으로 정리한 장표입니다.",
};

/**
 * 장표에 박히는 숫자를 매번 DB 에서 셉니다.
 *
 * force-dynamic 인 이유 — 시드를 다시 돌린 직후에 발표하는 일이 잦습니다.
 * ISR 캐시가 남아 있으면 화면과 말이 어긋납니다. 페이지 하나뿐이라 비용도 없습니다.
 */
export const dynamic = "force-dynamic";

export default async function DeckPage() {
  const counts = await getDeckCounts();
  const slides = buildDeck(counts);

  return (
    <div className="container-page py-6">
      <DeckViewer slides={slides} />
    </div>
  );
}
