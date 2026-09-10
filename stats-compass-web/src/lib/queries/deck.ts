import "server-only";
import { getSupabase } from "@/lib/supabase/server";

/**
 * 발표 장표에 박히는 숫자.
 *
 * 손으로 적어 두면 반드시 낡습니다. 시드를 한 번 더 돌린 다음 장표만 그대로면
 * 발표석에서 화면과 말이 어긋납니다. 그래서 렌더할 때 DB 에 직접 셉니다.
 *
 * safe() 를 쓰지 않는 이유 — safe() 는 data 만 돌려주고 count 를 버립니다.
 * head:true 로 행은 받지 않고 개수만 받습니다.
 */

export interface DeckCounts {
  classes: number | null;
  properties: number | null;
  entities: number | null;
  relations: number | null;
  surveys: number | null;
  tables: number | null;
  embedded: number | null;
}

export const EMPTY_COUNTS: DeckCounts = {
  classes: null,
  properties: null,
  entities: null,
  relations: null,
  surveys: null,
  tables: null,
  embedded: null,
};

/** 실패하면 null. 장표는 숫자가 없으면 "—" 를 찍고 넘어갑니다. */
async function countOf(table: string, filter?: { col: string; val: string }): Promise<number | null> {
  try {
    let q = getSupabase().from(table).select("*", { count: "exact", head: true });
    if (filter) q = q.eq(filter.col, filter.val);
    const { count, error } = await q;
    if (error) {
      console.error("[deck]", table, error.message);
      return null;
    }
    return count ?? null;
  } catch (e) {
    console.error("[deck]", table, e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function getDeckCounts(): Promise<DeckCounts> {
  const [classes, properties, entities, relations, surveys, tables, embedded] = await Promise.all([
    countOf("ontology_classes"),
    countOf("ontology_properties"),
    countOf("ontology_entities"),
    countOf("ontology_relations"),
    countOf("ontology_entities", { col: "class_id", val: "Survey" }),
    countOf("ontology_entities", { col: "class_id", val: "StatisticalTable" }),
    countOf("ontology_embeddings"),
  ]);

  return { classes, properties, entities, relations, surveys, tables, embedded };
}
