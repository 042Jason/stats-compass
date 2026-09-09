import { ExternalLink } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { KOSIS_HOME } from "@/lib/constants";

interface KosisLinkButtonProps extends Omit<ButtonProps, "asChild" | "children"> {
  /** 통계표/조사의 KOSIS URL. 없으면 KOSIS 검색 페이지로 */
  href?: string | null;
  /** href 가 없을 때 KOSIS 검색에 쓸 키워드 */
  fallbackQuery?: string;
  label?: string;
}

/** KOSIS 국가통계포털 새 창 링크 버튼 */
export function KosisLinkButton({ href, fallbackQuery, label = "KOSIS에서 보기", ...props }: KosisLinkButtonProps) {
  const url =
    href && /^https?:\/\//.test(href)
      ? href
      : fallbackQuery
        ? `${KOSIS_HOME}/search/search.do?query=${encodeURIComponent(fallbackQuery)}`
        : KOSIS_HOME;
  return (
    <Button asChild {...props}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
        <ExternalLink aria-hidden />
        <span className="sr-only">(새 창에서 열림)</span>
      </a>
    </Button>
  );
}
