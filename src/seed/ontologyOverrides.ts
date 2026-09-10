/**
 * 사람이 엑셀에서 고친 것을 그래프에 다시 얹는 층.
 *
 * 12_buildOntology 는 그래프를 매번 처음부터 다시 만듭니다. 그래서 이 층이 없으면
 * 18_applyOntologyEdits.ts 로 넣은 수정분이 재빌드 한 번에 전부 날아갑니다.
 *
 * 순서가 중요합니다. 자동 생성분이 먼저, 사람 손이 나중 — **사람이 이깁니다.**
 *
 * 파일이 없으면 조용히 아무 일도 하지 않습니다. 첫 빌드에는 당연히 없기 때문입니다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { log } from '../utils/logger.js';

const FILE = 'data/seed/17_overrides.json';

export interface EntityOverride {
  classId: string;
  key: string;
  label?: string;
  altLabels?: string[];
  description?: string | null;
  deleted?: true;
}

export interface RelationOverride {
  propertyId: string;
  sourceClass: string;
  sourceKey: string;
  targetClass: string;
  targetKey: string;
  evidence?: string | null;
  deleted?: true;
}

export interface Overrides {
  updatedAt?: string;
  entities?: EntityOverride[];
  relations?: RelationOverride[];
}

/** 12_buildOntology 의 in-memory 노드 모양 중 우리가 건드리는 부분만 */
interface EntLike {
  class_id: string;
  key: string;
  label: string;
  alt_labels: string[];
  description: string | null;
}
interface RelLike {
  property_id: string;
  source: string;
  target: string;
}

export function applyOverrides(
  ents: Map<string, EntLike>,
  rels: Map<string, RelLike>,
  ref: (classId: string, key: string) => string,
  addRel: (
    propertyId: string,
    source: string,
    target: string,
    opts?: { weight?: number; evidence?: string; symmetric?: boolean },
  ) => void,
): void {
  if (!existsSync(FILE)) return;

  let ov: Overrides;
  try {
    ov = JSON.parse(readFileSync(FILE, 'utf8')) as Overrides;
  } catch (e) {
    log.warn(`${FILE} 를 읽지 못해 건너뜁니다: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  let touched = 0;
  let dropped = 0;
  const orphan: string[] = [];

  for (const o of ov.entities ?? []) {
    const k = ref(o.classId, o.key);
    const e = ents.get(k);
    if (!e) {
      // 자동 생성 쪽에서 사라진 노드입니다. 조사 목록이 바뀌면 생길 수 있습니다.
      orphan.push(`${o.classId}/${o.key}`);
      continue;
    }
    if (o.deleted) {
      ents.delete(k);
      dropped++;
      continue;
    }
    if (o.label !== undefined) e.label = o.label;
    if (o.altLabels !== undefined) e.alt_labels = o.altLabels;
    if (o.description !== undefined) e.description = o.description;
    touched++;
  }

  let relAdded = 0;
  let relDropped = 0;
  for (const o of ov.relations ?? []) {
    const src = ref(o.sourceClass, o.sourceKey);
    const tgt = ref(o.targetClass, o.targetKey);
    if (!ents.has(src) || !ents.has(tgt)) {
      orphan.push(`${o.propertyId}: ${o.sourceKey} → ${o.targetKey}`);
      continue;
    }
    if (o.deleted) {
      // 대칭 관계는 어느 방향으로 저장됐는지 알 수 없어 양쪽 다 지웁니다.
      for (const key of [
        `${o.propertyId}|${src}|${tgt}`,
        `${o.propertyId}|${tgt}|${src}`,
      ]) {
        if (rels.delete(key)) relDropped++;
      }
      continue;
    }
    addRel(o.propertyId, src, tgt, { evidence: o.evidence ?? undefined });
    relAdded++;
  }

  const parts = [
    touched > 0 ? `노드 ${touched}건 수정` : null,
    dropped > 0 ? `노드 ${dropped}건 삭제` : null,
    relAdded > 0 ? `관계 ${relAdded}건 추가` : null,
    relDropped > 0 ? `관계 ${relDropped}건 삭제` : null,
  ].filter(Boolean);

  if (parts.length === 0) {
    log.info(`${FILE} 에 반영할 것이 없습니다`);
  } else {
    log.info(`엑셀 수정분 반영 — ${parts.join(' · ')}`);
  }
  if (orphan.length > 0) {
    log.warn(
      `수정분이 가리키는 노드가 사라져 ${orphan.length}건 건너뜀: ${orphan.slice(0, 5).join(' / ')}`,
    );
  }
}
