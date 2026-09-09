import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 서버 컴포넌트 전용 Supabase 클라이언트.
 * - anon(publishable) key 만 사용 → RLS 정책상 읽기 전용
 * - 세션/쿠키 없음 (공개 데이터만 조회)
 * - fetch 에 Next.js 캐시 힌트를 주어 ISR 처럼 동작 (기본 5분)
 */

export const DEFAULT_REVALIDATE = 300;

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다.",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, next: { revalidate: DEFAULT_REVALIDATE } }),
    },
  });
  return cached;
}

export type QueryResult<T> = { data: T; error: null } | { data: null; error: string };

/**
 * Supabase 호출을 감싸 실패 시 예외 대신 error 문자열을 돌려줍니다.
 * 페이지에서는 `error` 가 있으면 fallback UI 를 렌더링합니다.
 */
export async function safe<T>(fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<QueryResult<T>> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.error("[supabase]", error.message);
      return { data: null, error: error.message };
    }
    return { data: (data ?? ([] as unknown as T)) as T, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[supabase]", message);
    return { data: null, error: message };
  }
}
