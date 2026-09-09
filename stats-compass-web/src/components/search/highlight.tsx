import * as React from "react";

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 검색어(공백 구분 복수 단어)를 <mark> 로 강조 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0 || !text) return <>{text}</>;

  const pattern = terms.map(escapeRegExp).join("|");
  const splitRe = new RegExp(`(${pattern})`, "gi");
  const testRe = new RegExp(`^(?:${pattern})$`, "i"); // g 플래그 없이 → lastIndex 상태 문제 방지
  const parts = text.split(splitRe);
  return (
    <>
      {parts.map((part, i) =>
        testRe.test(part) ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
