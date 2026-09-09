import { NextResponse } from "next/server";
import { fetchMany, type FetchOpts } from "@/lib/kosis";

/**
 * 선택한 통계표들의 수치를 KOSIS 에서 받아옵니다.
 *
 * 브라우저가 KOSIS 를 직접 부르지 않습니다. 그러면 API 키가 노출됩니다.
 * 화면 → 이 라우트 → KOSIS 순서로 갑니다.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 한 번에 받을 수 있는 표 수. KOSIS 분당 200회 제한을 지키기 위한 상한입니다. */
const MAX_ITEMS = 16;
const ALLOWED_PRD = new Set(["Y", "H", "Q", "M", "D", "F", "IR"]);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다" }, { status: 400 });
  }

  const b = (body ?? {}) as {
    items?: Array<{ orgId?: unknown; tblId?: unknown; knownPrdSe?: unknown }>;
    prdSe?: unknown;
    count?: unknown;
  };

  // prdSe 가 "auto" 거나 없으면 표마다 DB 가 아는 주기(knownPrdSe)를 씁니다.
  // 통계표는 연간·분기·월간이 뒤섞여 있어 하나로 강제하면 절반이 빈 결과가 됩니다.
  const prdSe = typeof b.prdSe === "string" && ALLOWED_PRD.has(b.prdSe) ? b.prdSe : null;
  const countRaw = Number(b.count);
  const count = Number.isFinite(countRaw) ? Math.min(20, Math.max(1, Math.trunc(countRaw))) : 5;

  const items: FetchOpts[] = (Array.isArray(b.items) ? b.items : [])
    .map((x) => ({
      orgId: String(x?.orgId ?? ""),
      tblId: String(x?.tblId ?? ""),
      knownPrdSe: typeof x?.knownPrdSe === "string" && x.knownPrdSe !== "" ? x.knownPrdSe : null,
      prdSe,
      count,
    }))
    .filter((x) => x.orgId !== "" && x.tblId !== "")
    .slice(0, MAX_ITEMS);

  if (items.length === 0) {
    return NextResponse.json({ error: "통계표를 하나 이상 선택하세요" }, { status: 400 });
  }

  const series = await fetchMany(items);
  return NextResponse.json({ prdSe, count, series });
}
