import { NextResponse } from "next/server";
import { toRagResult } from "@/lib/graphrag";
import { rankTables } from "@/lib/rank-tables";

/**
 * 통계표 순서를 질문에 맞춰 다시 매깁니다.
 *
 * 검색과 따로 부릅니다. 목록은 이미 화면에 떠 있고, 순서만 뒤늦게 바뀝니다.
 * 이 호출이 실패해도 화면은 검색 순서 그대로 멀쩡히 동작합니다 — 그래서
 * 실패를 502 로 올리지 않고 항등 순열과 함께 200 으로 돌려줍니다.
 *
 * 화면이 가진 결과를 그대로 받습니다. 서버가 검색을 다시 돌리지 않습니다.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "본문을 읽지 못했습니다" }, { status: 400 });
  }

  const b = (body ?? {}) as { question?: unknown; tables?: unknown };
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 500) : "";
  if (!question) return NextResponse.json({ error: "질문이 비어 있습니다" }, { status: 400 });

  // toRagResult 의 표 정규화를 그대로 씁니다. 파싱 규칙을 두 벌 두지 않습니다.
  const tables = toRagResult({ tables: b.tables }).tables;
  if (tables.length === 0) {
    return NextResponse.json({ order: [], reasons: {}, focus: null, error: null });
  }

  const out = await rankTables(question, tables);
  return NextResponse.json(out);
}
