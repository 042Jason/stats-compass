import "server-only";

/**
 * 질문을 임베딩합니다. 시드 스크립트(15_embed.ts)와 같은 모델·차원을 써야 합니다.
 * 키는 서버에만 둡니다 (NEXT_PUBLIC_ 접두사 금지).
 */
const MODEL = "text-embedding-3-small";
const DIM = 1536;

export type EmbedResult = { vector: number[]; error: null } | { vector: null; error: string };

export async function embedQuery(text: string): Promise<EmbedResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // 흔한 함정: 저장소 루트의 .env 에 넣어두는 것.
    // Next.js 는 자기 프로젝트 루트의 env 파일만 읽습니다. 한 칸 위 폴더는 보지 않습니다.
    return {
      vector: null,
      error:
        "OPENAI_API_KEY 가 없습니다. stats-compass-web/.env.local 에 넣고 dev 서버를 다시 시작하세요. " +
        "(저장소 루트의 .env 는 Next.js 가 읽지 않습니다. NEXT_PUBLIC_ 접두사는 붙이지 마세요 — 붙이면 브라우저에 노출됩니다.)",
    };
  }

  const q = text.trim().slice(0, 2000);
  if (!q) return { vector: null, error: "질문이 비어 있습니다." };

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input: q, dimensions: DIM }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return { vector: null, error: `임베딩 호출 실패 (${res.status}) ${detail}` };
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vector = json.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== DIM) {
      return { vector: null, error: "임베딩 응답 형식이 예상과 다릅니다." };
    }
    return { vector, error: null };
  } catch (e) {
    return { vector: null, error: e instanceof Error ? e.message : String(e) };
  }
}
