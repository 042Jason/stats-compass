import { NextResponse } from "next/server";
import { toRagResult } from "@/lib/graphrag";
import { EMPTY_SLOTS, type ResolvedSlots } from "@/lib/slots";
import { writeBriefing } from "@/lib/answer";

/**
 * 검색 결과를 컨텍스트로 LLM 길잡이를 씁니다.
 *
 * 검색과 분리한 이유 — 검색은 1~2초, LLM 은 5~10초입니다. 한 요청으로 묶으면
 * 결과 목록이 LLM 을 기다리느라 늦게 뜹니다. 목록을 먼저 보여 주고 길잡이는
 * 따라오게 합니다.
 *
 * 화면이 이미 가진 결과를 그대로 보내옵니다. 서버가 검색을 다시 돌리지 않습니다
 * — 임베딩 호출 한 번과 DB 왕복 한 번을 아낍니다.
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

  const b = (body ?? {}) as { question?: unknown; slots?: unknown; result?: unknown };
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 500) : "";
  if (!question) return NextResponse.json({ error: "질문이 비어 있습니다" }, { status: 400 });

  const slots: ResolvedSlots = { ...EMPTY_SLOTS, ...((b.slots ?? {}) as Partial<ResolvedSlots>) };
  const result = toRagResult(b.result);

  const out = await writeBriefing(question, slots, result);
  if (out.error !== null) return NextResponse.json({ error: out.error }, { status: 502 });
  return NextResponse.json({ text: out.text });
}
