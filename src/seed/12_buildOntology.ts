/**
 * 온톨로지 그래프 구축
 *
 * Supabase 의 statistics / curated_sets 와 로컬 정규화 맵을 읽어
 * ontology_entities / ontology_relations 를 채웁니다.
 *
 * 사전 준비: supabase/0004_ontology.sql 을 SQL Editor 에서 한 번 실행
 *
 *   npx tsx src/seed/12_buildOntology.ts --dry-run
 *   npx tsx src/seed/12_buildOntology.ts
 *
 * 설계 근거는 docs/ontology-design.md 를 보세요.
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';

const CONCEPTS_FILE = 'data/seed/12_concepts.json';
const STAGES_FILE = 'data/seed/13_stages.json';
const INDICATORS_FILE = 'data/seed/13_indicators.json';
const QUESTIONS_FILE = 'data/seed/13_questions.json';
const ALIAS_FILES = ['data/seed/13_aliases_survey.json', 'data/seed/13_aliases_node.json'];
const REGIONS_FILE = 'data/seed/13_regions.json';
const DIMENSIONS_FILE = 'data/seed/13_dimensions.json';
/**
 * 조사 하나당 노드로 올릴 통계표 상한.
 * 대상 27개 조사만 다루므로 전부 올립니다. 0 이하면 무제한입니다.
 */
const TABLE_CAP = 0;
const CONFUSIONS_FILE = 'data/seed/12_confusions.json';
const SNAPSHOT_FILE = 'data/seed/12_ontology.json';
const DRY = process.argv.includes('--dry-run');

const FREQ_BASE = 'http://publications.europa.eu/resource/authority/frequency/';

/* ── 입력 타입 ───────────────────────────────────────────────────────────── */

interface ConceptMap {
  groups: Array<{ key: string; label: string; description?: string }>;
  concepts: Array<{
    key: string;
    label: string;
    alt?: string[];
    group: string;
    description?: string;
    aliases: string[];
  }>;
}

interface Confusion {
  a: string;
  b: string;
  why: string;
  source?: string;
  evidence?: string;
}

interface StageFile {
  stages: Array<{ key: string; order: number; label: string; description?: string }>;
  surveyStages: Record<string, string[]>;
}
interface IndicatorFile {
  indicators: Array<{
    key: string; label: string; alt?: string[]; description?: string; unit?: string;
    stages: string[]; measuredBy: string[]; note?: string;
  }>;
}
interface QuestionFile {
  questions: Array<{
    key: string; label: string; description?: string; stages: string[];
    answeredBy: string[]; indicators?: string[]; caution?: string;
  }>;
}

interface RegionFile {
  regions: Array<{ key: string; label: string; level: string; alt?: string[]; formerCode?: string }>;
}
interface DimensionFile {
  ageBands: Array<{
    key: string; label: string; from: number; to: number; alt?: string[]; stages: string[];
  }>;
  sexes: Array<{ key: string; label: string; alt?: string[] }>;
  maritalStatuses?: Array<{ key: string; label: string; alt?: string[] }>;
}

/** 별칭 사전. alt 는 skos:altLabel, hidden 은 skos:hiddenLabel 입니다. */
interface AliasFile {
  aliases: Array<{ class: string; key: string; alt?: string[]; hidden?: string[] }>;
}

interface StatRow {
  id: string;
  stat_id: string;
  name_ko: string;
  agency: string | null;
  category: string | null;
  frequency: string | null;
  tags: unknown;
  ai_content: unknown;
  raw_meta: unknown;
}

/* ── 그래프 빌더 ─────────────────────────────────────────────────────────── */

interface Ent {
  class_id: string;
  key: string;
  label: string;
  alt_labels: string[];
  description: string | null;
  std_uri: string | null;
  statistic_id: string | null;
  props: Record<string, unknown>;
  weight: number;
}

interface Rel {
  property_id: string;
  source: string; // 'Class|key'
  target: string;
  weight: number;
  evidence: string | null;
}

const ents = new Map<string, Ent>();
const rels = new Map<string, Rel>();

const ref = (classId: string, key: string) => `${classId}|${key}`;

function addEnt(
  classId: string,
  key: string,
  label: string,
  extra: Partial<Ent> = {},
): string {
  const k = ref(classId, key);
  const cur = ents.get(k);
  if (cur) {
    // 이미 있으면 비어 있는 칸만 채웁니다.
    if (!cur.description && extra.description) cur.description = extra.description;
    if (!cur.std_uri && extra.std_uri) cur.std_uri = extra.std_uri;
    for (const a of extra.alt_labels ?? []) if (!cur.alt_labels.includes(a)) cur.alt_labels.push(a);
    Object.assign(cur.props, extra.props ?? {});
    return k;
  }
  ents.set(k, {
    class_id: classId,
    key,
    label,
    alt_labels: extra.alt_labels ?? [],
    description: extra.description ?? null,
    std_uri: extra.std_uri ?? null,
    statistic_id: extra.statistic_id ?? null,
    props: extra.props ?? {},
    weight: 1,
  });
  return k;
}

/** 대칭 관계는 항상 같은 방향으로 저장해 중복을 막습니다. */
function addRel(
  propertyId: string,
  source: string,
  target: string,
  opts: { weight?: number; evidence?: string; symmetric?: boolean } = {},
): void {
  if (source === target) return;
  let [s, t] = [source, target];
  if (opts.symmetric && s > t) [s, t] = [t, s];
  const k = `${propertyId}|${s}|${t}`;
  const cur = rels.get(k);
  if (cur) {
    cur.weight = Math.max(cur.weight, opts.weight ?? 1);
    if (!cur.evidence && opts.evidence) cur.evidence = opts.evidence;
    return;
  }
  rels.set(k, {
    property_id: propertyId,
    source: s,
    target: t,
    weight: opts.weight ?? 1,
    evidence: opts.evidence ?? null,
  });
}

/* ── 유틸 ────────────────────────────────────────────────────────────────── */

const slug = (v: string) =>
  v.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}·ㆍ()-]/gu, '').slice(0, 80) || 'x';

const asArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      return asArray(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return [];
};

/** '1년' '월' '5년' → EU frequency 코드. 확인 못 한 값은 URI 를 비웁니다. */
function frequencyOf(raw: string | null): { key: string; label: string; uri: string | null } | null {
  const v = (raw ?? '').replace(/\s+/g, '');
  if (!v || v === '기타' || v === '-') return null;
  const table: Array<[RegExp, string, string, string | null]> = [
    [/^(월|매월|1월|월별)$/, 'monthly', '매월', `${FREQ_BASE}MONTHLY`],
    [/^(분기|3월|분기별)$/, 'quarterly', '분기', `${FREQ_BASE}QUARTERLY`],
    [/^(반기|6월|반기별)$/, 'semiannual', '반기', `${FREQ_BASE}ANNUAL_2`],
    [/^(1년|년|연간|매년|연1회)$/, 'annual', '매년', `${FREQ_BASE}ANNUAL`],
    [/^2년$/, 'biennial', '2년마다', `${FREQ_BASE}BIENNIAL`],
    [/^3년$/, 'triennial', '3년마다', `${FREQ_BASE}TRIENNIAL`],
    [/^5년$/, 'quinquennial', '5년마다', `${FREQ_BASE}QUINQUENNIAL`],
    [/^부정기$/, 'irregular', '부정기', `${FREQ_BASE}IRREG`],
  ];
  for (const [re, key, label, uri] of table) if (re.test(v)) return { key, label, uri };
  // 순기(10일) 처럼 표준 코드에 없는 주기는 라벨만 남기고 URI 는 붙이지 않습니다.
  return { key: slug(v), label: raw!.trim(), uri: null };
}

/**
 * '통계법 제17조 ...' '농림어업총조사 규칙(기획재정부령 제804호, 2020.9.1. 일부개정)' → 법령명
 *
 * 괄호 안에는 공포번호와 개정일이 들어 있고 그 안에도 쉼표가 있어서, 괄호를 먼저 걷어내지 않으면
 * '2020.9.1. 일부개정)' 같은 조각이 법령명으로 잡힙니다.
 */
function legalNames(raw: string): string[] {
  const out = new Set<string>();
  const text = raw
    .replace(/\([^)]*\)/g, ' ') // 괄호 안(공포번호·개정일)을 먼저 제거
    .replace(/[ㆍ․·]/g, '·')
    .replace(/\s+/g, ' ');

  for (const part of text.split(/\s*[,;/]\s*/)) {
    const chunk = part.replace(/^(?:동법|같은 법)\s*/, '').trim();
    if (!chunk) continue;
    // 법률 을 법 보다 먼저 시도해야 '법률' 이 '법' 에서 잘리지 않습니다.
    const m = chunk.match(/^(.*?(?:법률|규칙|시행령|법|령))(?![률])/);
    if (!m) continue;
    const name = m[1].trim();
    if (name.length < 3 || name.length > 40) continue;
    if (!/(?:법률|규칙|시행령|법|령)$/.test(name)) continue;
    out.add(name);
  }
  return [...out];
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/* ── 메인 ────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const conceptMap: ConceptMap = JSON.parse(readFileSync(CONCEPTS_FILE, 'utf-8'));
  const confusions: Confusion[] = JSON.parse(readFileSync(CONFUSIONS_FILE, 'utf-8'));

  const { data: statsRaw, error } = await supabase
    .from('statistics')
    .select('id, stat_id, name_ko, agency, category, frequency, tags, ai_content, raw_meta')
    .eq('status', 'active')
    .order('name_ko');
  if (error) throw error;
  const stats = (statsRaw ?? []) as StatRow[];
  log.info(`조사 ${stats.length}건 로드`);

  /* 1. 카탈로그 */
  const catalog = addEnt('Catalog', 'kostat-approved', '국가승인통계 카탈로그', {
    description: '국가데이터처가 작성하는 국가승인통계를 모은 카탈로그입니다.',
  });

  /* 2. 조사 + 조사에서 나가는 관계 */
  const surveyByName = new Map<string, string>();
  const conceptsOfSurvey = new Map<string, Set<string>>(); // surveyRef -> concept ref
  const tagsOfSurvey = new Map<string, Set<string>>();

  // 원본 용어 → 정규화 개념 키 (복합어는 여러 개)
  const aliasToConcepts = new Map<string, string[]>();
  for (const c of conceptMap.concepts) {
    for (const a of c.aliases) {
      const norm = a.trim();
      const cur = aliasToConcepts.get(norm) ?? [];
      if (!cur.includes(c.key)) cur.push(c.key);
      aliasToConcepts.set(norm, cur);
    }
  }

  /* 2-1. 개념군과 개념을 먼저 만듭니다. */
  for (const g of conceptMap.groups) {
    addEnt('Concept', g.key, g.label, {
      description: g.description ?? null,
      props: { isGroup: true },
    });
  }
  for (const c of conceptMap.concepts) {
    const cref = addEnt('Concept', c.key, c.label, {
      alt_labels: c.alt ?? [],
      description: c.description ?? null,
      props: { isGroup: false },
    });
    const gref = ref('Concept', c.group);
    if (ents.has(gref)) addRel('broaderConcept', cref, gref);
    else log.warn(`  개념군 없음: ${c.group} (${c.key})`);
  }

  let unknownTerms = 0;

  for (const s of stats) {
    const sref = addEnt('Survey', s.stat_id, s.name_ko, {
      statistic_id: s.id,
      description:
        (s.ai_content && typeof s.ai_content === 'object'
          ? ((s.ai_content as Record<string, unknown>).overview as string | undefined)
          : undefined) ?? null,
      props: { statId: s.stat_id },
    });
    surveyByName.set(s.name_ko, sref);
    addRel('inCatalog', sref, catalog);

    if (s.agency) {
      addRel('producedBy', sref, addEnt('Agency', slug(s.agency), s.agency));
    }
    if (s.category) {
      addRel('hasTheme', sref, addEnt('Theme', slug(s.category), s.category));
    }
    const freq = frequencyOf(s.frequency);
    if (freq) {
      addRel(
        'hasFrequency',
        sref,
        addEnt('Frequency', freq.key, freq.label, { std_uri: freq.uri }),
      );
    }

    const tagSet = new Set<string>();
    for (const t of asArray(s.tags)) {
      const tref = addEnt('Keyword', slug(t), t);
      addRel('hasKeyword', sref, tref);
      tagSet.add(tref);
    }
    tagsOfSurvey.set(sref, tagSet);

    // 법적근거
    const meta = (s.raw_meta ?? {}) as Record<string, unknown>;
    const legalRaw = String(meta.LAWFUL_BAS ?? meta.basisLaw ?? '').trim();
    if (legalRaw && legalRaw !== '-') {
      for (const name of legalNames(legalRaw)) {
        addRel('basedOn', sref, addEnt('LegalBasis', slug(name), name), { evidence: legalRaw });
      }
    }

    // 개념
    const ai = (s.ai_content ?? {}) as Record<string, unknown>;
    const terms = Array.isArray(ai.terms) ? (ai.terms as Array<Record<string, unknown>>) : [];
    const set = new Set<string>();
    for (const t of terms) {
      const label = String(t.term ?? '').trim();
      if (!label) continue;
      const keys = aliasToConcepts.get(label);
      if (!keys) {
        unknownTerms++;
        log.warn(`  정규화 맵에 없는 용어: ${label} (${s.name_ko})`);
        continue;
      }
      for (const key of keys) {
        const cref = ref('Concept', key);
        if (!ents.has(cref)) continue;
        addRel('definesConcept', sref, cref, { evidence: String(t.plain ?? '') || undefined });
        set.add(cref);
      }
    }
    conceptsOfSurvey.set(sref, set);
  }

  /* 3. 조사 ↔ 조사: 개념 공유 */
  const surveyRefs = [...conceptsOfSurvey.keys()];
  for (let i = 0; i < surveyRefs.length; i++) {
    for (let j = i + 1; j < surveyRefs.length; j++) {
      const a = conceptsOfSurvey.get(surveyRefs[i])!;
      const b = conceptsOfSurvey.get(surveyRefs[j])!;
      const shared = [...a].filter((x) => b.has(x));
      if (shared.length === 0) continue;
      const labels = shared.map((r) => ents.get(r)?.label ?? '').filter(Boolean).slice(0, 4);
      addRel('sharesConceptWith', surveyRefs[i], surveyRefs[j], {
        weight: shared.length,
        symmetric: true,
        evidence: `공유 개념: ${labels.join(', ')}`,
      });
    }
  }

  /* 4. 조사 ↔ 조사: 주제어 겹침
   *
   * 태그는 조사마다 서너 개씩 붙어 있어서 "2개 이상 겹침" 만으로는 쌍이 너무 많아집니다.
   * 조사별로 가장 많이 겹치는 상위 5건만 남겨 그래프가 엉키지 않게 합니다. */
  const TAG_TOP_N = 5;
  for (const a of surveyRefs) {
    const setA = tagsOfSurvey.get(a) ?? new Set<string>();
    if (setA.size < 2) continue;
    const scored: Array<{ b: string; shared: string[] }> = [];
    for (const b of surveyRefs) {
      if (a === b) continue;
      const setB = tagsOfSurvey.get(b) ?? new Set<string>();
      const shared = [...setA].filter((x) => setB.has(x));
      if (shared.length >= 2) scored.push({ b, shared });
    }
    scored.sort((x, y) => y.shared.length - x.shared.length);
    for (const { b, shared } of scored.slice(0, TAG_TOP_N)) {
      const labels = shared.map((r) => ents.get(r)?.label ?? '').filter(Boolean);
      addRel('relatedTo', a, b, {
        weight: shared.length,
        symmetric: true,
        evidence: `공통 주제어: ${labels.join(', ')}`,
      });
    }
  }

  /* 5. 조사 ↔ 조사: 혼동 주의 */
  let confusionMiss = 0;
  for (const c of confusions) {
    const a = surveyByName.get(c.a);
    const b = surveyByName.get(c.b);
    if (!a || !b) {
      confusionMiss++;
      log.warn(`  혼동쌍 매칭 실패: ${c.a} ↔ ${c.b}`);
      continue;
    }
    addRel('oftenConfusedWith', a, b, { weight: 3, symmetric: true, evidence: c.why });
  }

  /* 6. 조사 ↔ 조사: 같은 큐레이션 세트 */
  const { data: setItems } = await supabase
    .from('curated_set_items')
    .select('set_id, statistic_id')
    .limit(1000);
  const bySet = new Map<string, string[]>();
  const statIdToRef = new Map<string, string>();
  for (const s of stats) statIdToRef.set(s.id, ref('Survey', s.stat_id));
  for (const it of setItems ?? []) {
    const r = statIdToRef.get(String((it as Record<string, unknown>).statistic_id));
    if (!r) continue;
    const k = String((it as Record<string, unknown>).set_id);
    bySet.set(k, [...(bySet.get(k) ?? []), r]);
  }
  for (const members of bySet.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        addRel('complements', members[i], members[j], {
          symmetric: true,
          evidence: '같은 큐레이션 세트에 함께 담겼습니다.',
        });
      }
    }
  }

  /* 7. 개념 ↔ 개념: 두 개 이상 조사에서 함께 등장 */
  const pairCount = new Map<string, number>();
  for (const set of conceptsOfSurvey.values()) {
    const arr = [...set].sort();
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++)
        pairCount.set(`${arr[i]}||${arr[j]}`, (pairCount.get(`${arr[i]}||${arr[j]}`) ?? 0) + 1);
  }
  for (const [k, n] of pairCount) {
    if (n < 2) continue;
    const [a, b] = k.split('||');
    addRel('relatedConcept', a, b, { weight: n, symmetric: true });
  }

  /* 7-2. 생애주기 레이어 — 생애단계 · 핵심지표 · 연구질문
   *
   * 13_*.json 이 없으면 이 블록은 통째로 건너뜁니다(기존 온톨로지만 만들어집니다).
   * 대상 조사는 13_stages.json 의 surveyStages 에 적힌 것들입니다. */
  const stageFile = readJson<StageFile>(STAGES_FILE);
  const targetSurveys = new Set<string>();
  const targetStatIds: string[] = [];

  if (!stageFile) {
    log.warn(`${STAGES_FILE} 가 없어 생애주기 레이어를 건너뜁니다`);
  } else {
    const stageRef = new Map<string, string>();
    const ordered = [...stageFile.stages].sort((a, b) => a.order - b.order);
    for (const st of ordered) {
      stageRef.set(
        st.key,
        addEnt('LifeStage', st.key, st.label, {
          description: st.description ?? null,
          props: { order: st.order },
        }),
      );
    }
    for (let i = 0; i < ordered.length - 1; i++) {
      addRel('precedesStage', stageRef.get(ordered[i].key)!, stageRef.get(ordered[i + 1].key)!);
    }

    const statRefById = new Map(stats.map((s) => [ref('Survey', s.stat_id), s.id]));
    for (const [name, keys] of Object.entries(stageFile.surveyStages)) {
      const sref = surveyByName.get(name);
      if (!sref) {
        log.warn(`  생애단계 매핑 실패(조사 없음): ${name}`);
        continue;
      }
      targetSurveys.add(sref);
      const sid = statRefById.get(sref);
      if (sid) targetStatIds.push(sid);
      for (const k of keys) {
        const t = stageRef.get(k);
        if (t) addRel('coversLifeStage', sref, t);
        else log.warn(`  없는 생애단계 키: ${k} (${name})`);
      }
    }

    // 핵심지표
    const indRef = new Map<string, string>();
    const indLabels: string[] = [];
    for (const ind of readJson<IndicatorFile>(INDICATORS_FILE)?.indicators ?? []) {
      const iref = addEnt('Indicator', ind.key, ind.label, {
        alt_labels: ind.alt ?? [],
        description: ind.description ?? null,
        props: { unit: ind.unit ?? '', note: ind.note ?? '' },
      });
      indRef.set(ind.key, iref);
      indLabels.push(ind.label);
      for (const k of ind.stages) {
        const t = stageRef.get(k);
        if (t) addRel('indicatorForStage', iref, t);
      }
      for (const n of ind.measuredBy) {
        const sref = surveyByName.get(n);
        if (sref) addRel('measuredBy', iref, sref, { evidence: ind.note || undefined });
        else log.warn(`  지표 ${ind.label} 의 조사 매칭 실패: ${n}`);
      }
    }

    // 연구질문 (GraphRAG 진입점)
    for (const q of readJson<QuestionFile>(QUESTIONS_FILE)?.questions ?? []) {
      const qref = addEnt('ResearchQuestion', q.key, q.label, {
        description: q.description ?? null,
        props: { caution: q.caution ?? '' },
      });
      for (const k of q.stages) {
        const t = stageRef.get(k);
        if (t) addRel('questionForStage', qref, t);
      }
      for (const n of q.answeredBy) {
        const sref = surveyByName.get(n);
        if (sref) addRel('answeredBy', qref, sref, { evidence: q.caution || undefined });
        else log.warn(`  질문 ${q.key} 의 조사 매칭 실패: ${n}`);
      }
      for (const k of q.indicators ?? []) {
        const t = indRef.get(k);
        if (t) addRel('usesIndicator', qref, t);
        else log.warn(`  질문 ${q.key} 의 지표 매칭 실패: ${k}`);
      }
    }

    /* 7-3. 통계표 계층 — 대상 조사의 표만 노드로 올립니다.
     *
     * 전체 11,163개를 다 올리면 그래프가 감당이 안 되므로 조사당 TABLE_CAP 개로 끊습니다.
     * 지표 이름이 표 제목에 들어 있는 표를 먼저 남겨 연구자가 찾을 만한 표가 살아남게 합니다. */
    if (targetStatIds.length > 0) {
      const tables: Array<Record<string, unknown>> = [];
      for (let from = 0; ; from += 1000) {
        const { data, error: te } = await supabase
          .from('statistic_tables')
          .select(
            'id, statistic_id, kosis_org_id, kosis_tbl_id, table_name, latest_period, first_period, prd_se',
          )
          .in('statistic_id', targetStatIds)
          // ORDER BY 없이 LIMIT/OFFSET 을 쓰면 페이지 간 순서가 보장되지 않아
          // 어떤 행은 중복되고 어떤 행은 아예 안 옵니다. 반드시 정렬해야 합니다.
          .order('id')
          .range(from, from + 999);
        if (te) throw te;
        tables.push(...((data ?? []) as Array<Record<string, unknown>>));
        if (!data || data.length < 1000) break;
      }
      log.info(`대상 조사 통계표 ${tables.length}건 로드`);

      const surveyRefByStatUuid = new Map<string, string>();
      for (const s of stats) surveyRefByStatUuid.set(s.id, ref('Survey', s.stat_id));

      const grouped = new Map<string, Array<Record<string, unknown>>>();
      for (const t of tables) {
        const k = String(t.statistic_id);
        grouped.set(k, [...(grouped.get(k) ?? []), t]);
      }

      /* 지역 단위 자동 판정 — 통계표 제목에 시군구/시도가 들어 있는지로 봅니다.
       *
       * "이 조사는 대전 값이 있나?" 는 연구자가 제일 먼저 막히는 지점인데
       * KOSIS 어디에도 정리돼 있지 않습니다. 표 이름으로 계산해 조사 노드에 붙입니다. */
      const RE_SGG = /시군구|시·군·구|읍면동/;
      const RE_SIDO = /시도|시·도|지역별/;
      for (const [statUuid, list] of grouped) {
        const sref = surveyRefByStatUuid.get(statUuid);
        if (!sref) continue;
        const names = list.map((t) => String(t.table_name ?? ''));
        const sgg = names.filter((n) => RE_SGG.test(n)).length;
        const sido = names.filter((n) => RE_SIDO.test(n)).length;
        const level = sgg > 0 ? '시군구' : sido > 0 ? '시도' : '전국만';
        const e = ents.get(sref);
        if (e) {
          e.props.regionLevel = level;
          e.props.regionTables = { sido, sgg, total: names.length };
        }
      }
      log.info(
        '지역 단위 판정: ' +
          ['시군구', '시도', '전국만']
            .map(
              (lv) =>
                `${lv} ${[...targetSurveys].filter((r) => ents.get(r)?.props.regionLevel === lv).length}건`,
            )
            .join(' / '),
      );

      let kept = 0;
      for (const [statUuid, list] of grouped) {
        const sref = surveyRefByStatUuid.get(statUuid);
        if (!sref) continue;
        const scored = list
          .map((t) => {
            const name = String(t.table_name ?? '');
            const hits = indLabels.filter((L) => L.length >= 2 && name.includes(L)).length;
            return { t, name, hits };
          })
          .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name, 'ko'));
        const capped = TABLE_CAP > 0 ? scored.slice(0, TABLE_CAP) : scored;

        for (const { t, name, hits } of capped) {
          if (!name) continue;
          const key = `${t.kosis_org_id ?? ''}-${t.kosis_tbl_id ?? ''}`;
          const tref = addEnt('StatisticalTable', key, name, {
            props: {
              orgId: t.kosis_org_id ?? null,
              tblId: t.kosis_tbl_id ?? null,
              latestPeriod: t.latest_period ?? null,
              // 수록 주기와 시작시점. 화면이 표마다 맞는 주기로 KOSIS 를 부르는 데 씁니다.
              // 이게 없으면 주기를 추측하거나 표마다 메타를 다시 읽어야 합니다.
              firstPeriod: t.first_period ?? null,
              prdSe: t.prd_se ?? null,
              indicatorHits: hits,
            },
          });
          addRel('hasDistribution', sref, tref);
          kept++;
        }
      }
      log.info(`통계표 노드 ${kept}건` + (TABLE_CAP > 0 ? ` (조사당 최대 ${TABLE_CAP})` : ' (상한 없음)'));
    }

    /* 7-4. 보도자료 — 14_fetchNews.ts 가 채운 news_articles 를 그래프에 붙입니다. */
    const news: Array<Record<string, unknown>> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error: ne } = await supabase
        .from('news_articles')
        .select('id, board_id, list_no, title, url, published_on, department, survey_name, summary')
        .order('id')
        .range(from, from + 999);
      if (ne) {
        log.warn(`news_articles 조회 실패(테이블이 아직 없을 수 있습니다): ${ne.message}`);
        break;
      }
      news.push(...((data ?? []) as Array<Record<string, unknown>>));
      if (!data || data.length < 1000) break;
    }
    if (news.length > 0) {
      let linked = 0;
      for (const a of news) {
        const title = String(a.title ?? '').trim();
        const surveyName = String(a.survey_name ?? '');
        const sref = surveyByName.get(surveyName);
        if (!title || !sref) continue;
        const key = `${a.board_id ?? 'x'}-${a.list_no ?? a.id}`;
        const aref = addEnt('NewsArticle', key, title, {
          description: (a.summary as string | null) ?? null,
          props: {
            url: a.url ?? null,
            publishedOn: a.published_on ?? null,
            department: a.department ?? null,
          },
        });
        addRel('mentionsSurvey', aref, sref, {
          evidence: a.published_on ? `${a.published_on} 보도자료` : undefined,
        });
        linked++;
      }
      log.info(`보도자료 ${news.length}건 로드, ${linked}건 연결`);
    }
  }

  /* 7-4b. 지역 · 연령대 · 성별 — 질의 슬롯을 해석하는 층
   *
   * "대전" → 코드 30, "35살" → 30~39세 → 생애단계 3개.
   * 지금까지 코드에 하드코딩돼 있던 규칙을 데이터로 옮깁니다.
   *
   * 통계표마다 지역·연령·성별을 관계로 걸면 2만 3천 건이 생기는데 얻는 게 없습니다.
   * 지역 지원 여부는 통계표 props.regionLevel 로 두고, 여기서는 슬롯 해석만 담당합니다. */
  const regionFile = readJson<RegionFile>(REGIONS_FILE);
  if (regionFile) {
    const all = regionFile.regions;
    const nationwide = all.find((r) => r.level === '전국');
    const nref = nationwide
      ? addEnt('Region', nationwide.key, nationwide.label, {
          alt_labels: nationwide.alt ?? [],
          props: { level: nationwide.level },
        })
      : null;
    for (const r of all) {
      if (r.level === '전국') continue;
      const rref = addEnt('Region', r.key, r.label, {
        alt_labels: r.alt ?? [],
        props: {
          level: r.level,
          formerCode: r.formerCode ?? null,
          // KOSIS 는 통계표마다 분류코드 체계가 달라 objL 값이 이 코드와 다를 수 있습니다.
          kosisNote: '실제 objL 값은 통계표 분류 메타에서 확인해야 합니다',
        },
      });
      if (nref) addRel('narrowerRegion', nref, rref);
    }
    log.info(`지역 ${all.length}개`);
  } else {
    log.warn(`${REGIONS_FILE} 가 없어 지역 층을 건너뜁니다`);
  }

  const dimFile = readJson<DimensionFile>(DIMENSIONS_FILE);
  if (dimFile && stageFile) {
    const stageRefByKey = new Map<string, string>();
    for (const st of stageFile.stages) stageRefByKey.set(st.key, ref('LifeStage', st.key));

    let ageLinks = 0;
    for (const b of dimFile.ageBands) {
      const bref = addEnt('AgeBand', b.key, b.label, {
        alt_labels: b.alt ?? [],
        props: { from: b.from, to: b.to },
      });
      for (const k of b.stages) {
        const t = stageRefByKey.get(k);
        if (t && ents.has(t)) {
          addRel('stageForAge', bref, t);
          ageLinks++;
        }
      }
    }
    for (const x of dimFile.sexes) {
      addEnt('Sex', x.key, x.label, { alt_labels: x.alt ?? [] });
    }
    // 혼인상태는 값에 따라 결과가 크게 갈려 되묻기 대상이 됩니다.
    for (const x of dimFile.maritalStatuses ?? []) {
      addEnt('MaritalStatus', x.key, x.label, { alt_labels: x.alt ?? [] });
    }
    log.info(
      `연령대 ${dimFile.ageBands.length}개 (생애단계 연결 ${ageLinks}) · ` +
        `성별 ${dimFile.sexes.length}개 · 혼인상태 ${(dimFile.maritalStatuses ?? []).length}개`,
    );
  } else if (!dimFile) {
    log.warn(`${DIMENSIONS_FILE} 가 없어 연령대·성별 층을 건너뜁니다`);
  }

  /* 7-5. 별칭 붙이기 — 일상 표현으로도 검색되게 합니다.
   *
   * alt   = skos:altLabel   (공식 별칭·구명칭. 화면에 보여도 되는 것)
   * hidden= skos:hiddenLabel (구어·약칭·오칭. 검색에만 씁니다)
   * 둘 다 alt_labels 배열에 넣되, props.hiddenLabels 에 어떤 것이 hidden 인지 남깁니다. */
  let aliasCount = 0;
  let aliasMiss = 0;
  for (const file of ALIAS_FILES) {
    const data = readJson<AliasFile>(file);
    if (!data) {
      log.warn(`${file} 가 없어 건너뜁니다`);
      continue;
    }
    for (const a of data.aliases ?? []) {
      // Survey 는 key 가 조사명이므로 이름으로 찾습니다.
      const k = a.class === 'Survey' ? surveyByName.get(a.key) : ref(a.class, a.key);
      if (!k || !ents.has(k)) {
        aliasMiss++;
        log.warn(`  별칭 대상 없음: ${a.class}/${a.key}`);
        continue;
      }
      const e = ents.get(k)!;
      const hidden = (a.hidden ?? []).map((v) => v.trim()).filter(Boolean);
      for (const v of [...(a.alt ?? []), ...hidden]) {
        const t = v.trim();
        if (!t || t === e.label) continue;
        if (!e.alt_labels.includes(t)) {
          e.alt_labels.push(t);
          aliasCount++;
        }
      }
      if (hidden.length > 0) e.props.hiddenLabels = hidden;
    }
  }
  log.info(`별칭 ${aliasCount}개 반영` + (aliasMiss ? ` (대상 없음 ${aliasMiss}건)` : ''));

  /* 8. 노드 가중치 = 연결 수 */
  for (const r of rels.values()) {
    const s = ents.get(r.source);
    const t = ents.get(r.target);
    if (s) s.weight += 1;
    if (t) t.weight += 1;
  }

  /* 9. 요약 */
  const byClass = new Map<string, number>();
  for (const e of ents.values()) byClass.set(e.class_id, (byClass.get(e.class_id) ?? 0) + 1);
  const byProp = new Map<string, number>();
  for (const r of rels.values()) byProp.set(r.property_id, (byProp.get(r.property_id) ?? 0) + 1);

  log.info(`노드 ${ents.size}개`);
  for (const [k, v] of [...byClass].sort((a, b) => b[1] - a[1])) log.info(`   ${k}: ${v}`);
  log.info(`관계 ${rels.size}개`);
  for (const [k, v] of [...byProp].sort((a, b) => b[1] - a[1])) log.info(`   ${k}: ${v}`);
  if (unknownTerms) log.warn(`정규화 맵에 없는 용어 ${unknownTerms}건`);
  if (confusionMiss) log.warn(`매칭 실패한 혼동쌍 ${confusionMiss}건`);

  const isolated = [...ents.values()].filter((e) => e.weight <= 1);
  if (isolated.length) log.warn(`고아 노드 ${isolated.length}개: ${isolated.slice(0, 10).map((e) => e.label).join(', ')}`);

  writeFileSync(
    SNAPSHOT_FILE,
    JSON.stringify({ nodes: [...ents.values()], edges: [...rels.values()] }, null, 1),
    'utf-8',
  );
  log.ok(`스냅샷 -> ${SNAPSHOT_FILE}`);

  if (DRY) {
    log.warn('--dry-run 이므로 DB 를 수정하지 않았습니다.');
    return;
  }

  /* 10. 저장 — 엔티티는 (class_id, key) 로 upsert 해서 id 를 고정합니다. */
  const entRows = [...ents.values()].map((e) => ({
    class_id: e.class_id,
    key: e.key,
    label: e.label,
    alt_labels: e.alt_labels,
    description: e.description,
    std_uri: e.std_uri,
    statistic_id: e.statistic_id,
    props: e.props,
    weight: e.weight,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < entRows.length; i += 500) {
    const { error: e1 } = await supabase
      .from('ontology_entities')
      .upsert(entRows.slice(i, i + 500), { onConflict: 'class_id,key' });
    if (e1) throw e1;
    log.info(`  노드 ${Math.min(i + 500, entRows.length)}/${entRows.length}`);
  }

  // id 조회 (PostgREST 1000행 상한 때문에 range 로 나눠 받습니다)
  const idMap = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error: e2 } = await supabase
      .from('ontology_entities')
      .select('id, class_id, key')
      .range(from, from + 999);
    if (e2) throw e2;
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      idMap.set(ref(String(r.class_id), String(r.key)), String(r.id));
    }
    if (!data || data.length < 1000) break;
  }

  // 이번 실행에 없는 노드는 지웁니다 (관계는 cascade)
  const wanted = new Set(ents.keys());
  const stale = [...idMap.entries()].filter(([k]) => !wanted.has(k)).map(([, v]) => v);
  if (stale.length) {
    for (let i = 0; i < stale.length; i += 200) {
      const { error: e3 } = await supabase
        .from('ontology_entities')
        .delete()
        .in('id', stale.slice(i, i + 200));
      if (e3) throw e3;
    }
    log.info(`  낡은 노드 ${stale.length}개 삭제`);
  }

  // 관계는 통째로 갈아끼웁니다.
  const { error: e4 } = await supabase
    .from('ontology_relations')
    .delete()
    .not('id', 'is', null);
  if (e4) throw e4;

  const relRows = [...rels.values()]
    .map((r) => ({
      property_id: r.property_id,
      source_id: idMap.get(r.source),
      target_id: idMap.get(r.target),
      weight: r.weight,
      evidence: r.evidence,
    }))
    .filter((r) => r.source_id && r.target_id);

  for (let i = 0; i < relRows.length; i += 500) {
    const { error: e5 } = await supabase.from('ontology_relations').insert(relRows.slice(i, i + 500));
    if (e5) throw e5;
    log.info(`  관계 ${Math.min(i + 500, relRows.length)}/${relRows.length}`);
  }

  log.ok(`완료 — 노드 ${entRows.length}개, 관계 ${relRows.length}개`);
}

main().catch((e) => {
  log.err(String(e instanceof Error ? e.stack ?? e.message : e));
  process.exit(1);
});
