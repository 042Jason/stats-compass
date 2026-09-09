/**
 * 큐레이션 세트 시드
 *
 * 재그룹핑으로 확정된 52개 조사 중에서 주제별로 묶어 세트를 만듭니다.
 * 조사는 stat_id 로 지정하고, DB 에 없는 조사는 건너뛰므로 안전합니다.
 * 재실행하면 같은 slug 의 세트를 갱신하고 항목을 다시 채웁니다.
 *
 *   npx tsx src/seed/08_curatedSets.ts --dry-run
 *   npx tsx src/seed/08_curatedSets.ts
 */
import 'dotenv/config';
import { supabase } from '../clients/supabase.js';
import { log } from '../utils/logger.js';
import { toStatId } from '../utils/survey.js';

const DRY = process.argv.includes('--dry-run');

interface SetItem {
  /** 조사명 (stat_id 는 자동 변환) */
  survey: string;
  /** 이 세트에서 이 조사를 왜 보는지 */
  note: string;
}

interface SetDef {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
  items: SetItem[];
}

const SETS: SetDef[] = [
  {
    slug: 'prices-and-cost-of-living',
    title: '물가를 읽는 네 가지 각도',
    subtitle: '소비자가 체감하는 물가와 생산자가 마주하는 물가는 다릅니다',
    description:
      '“물가가 올랐다”는 말 하나에도 여러 통계가 얽혀 있습니다. 장바구니 기준인지, 농가가 파는 값인지, 기르는 데 드는 비용인지에 따라 답이 달라집니다. 네 조사를 나란히 놓고 보면 어느 수치를 인용해야 할지 판단할 수 있습니다.',
    tags: ['물가', '생활비', '농업'],
    items: [
      { survey: '소비자물가조사(2020=100)', note: '가구가 사는 상품·서비스 가격. 흔히 말하는 “물가”가 이것입니다.' },
      { survey: '농가판매및구입가격조사', note: '농가가 파는 값과 사는 값을 함께 봅니다. 소비자물가와 방향이 다를 수 있습니다.' },
      { survey: '산지쌀값조사', note: '산지 기준 쌀값. 소매가와는 유통 단계만큼 차이가 납니다.' },
      { survey: '농축산물생산비조사', note: '가격이 아니라 원가입니다. 가격 상승이 농가 소득으로 이어졌는지 판단할 때 씁니다.' },
    ],
  },
  {
    slug: 'jobs-and-wages',
    title: '일자리 통계 길잡이',
    subtitle: '고용률·실업률부터 일자리 이동까지, 무엇을 언제 보아야 하나',
    description:
      '일자리 통계는 조사 방식이 서로 달라 숫자가 어긋나 보일 때가 있습니다. 매월 표본조사로 잡는 고용 상황과, 행정자료로 사후에 집계하는 일자리 수는 애초에 다른 것을 세고 있습니다. 각 조사의 자리를 알고 나면 혼란이 줄어듭니다.',
    tags: ['고용', '노동', '임금'],
    items: [
      { survey: '경제활동인구조사', note: '월간 고용률·실업률의 출처. 표본조사라 속보성이 높습니다.' },
      { survey: '일자리행정통계', note: '행정자료 기반이라 늦게 나오지만 일자리 수를 실제에 가깝게 셉니다.' },
      { survey: '임금근로일자리동향행정통계', note: '임금근로 일자리의 증감을 분기 단위로 봅니다.' },
      { survey: '일자리이동통계', note: '사람이 어느 일자리에서 어디로 옮겼는지. 이동의 방향을 봅니다.' },
      { survey: '이민자체류실태및고용조사(구. 외국인고용조사)', note: '외국인 취업자는 위 조사들에서 충분히 포착되지 않습니다.' },
    ],
  },
  {
    slug: 'population-change',
    title: '인구 변화, 여섯 개의 창',
    subtitle: '태어나고 죽고 옮겨 다니는 흐름을 각각 다른 통계가 담습니다',
    description:
      '인구는 출생·사망·이동이라는 세 힘으로 움직입니다. 여기에 지금의 인구를 세는 총조사와 앞으로의 전망을 더하면 여섯 개의 창이 됩니다. 어떤 질문이냐에 따라 봐야 할 창이 달라집니다.',
    tags: ['인구', '출생·사망', '인구이동'],
    items: [
      { survey: '인구동향조사', note: '출생·사망·혼인·이혼의 월간 기록. 저출산 논의의 1차 출처입니다.' },
      { survey: '인구총조사', note: '지금 사는 사람을 세는 기준 통계. 다른 인구 통계의 모집단이 됩니다.' },
      { survey: '국내인구이동통계', note: '수도권 집중·지방 소멸을 이야기할 때 쓰는 전입·전출 자료.' },
      { survey: '국제인구이동통계', note: '국경을 넘는 이동. 최근 인구 증감에서 비중이 커졌습니다.' },
      { survey: '장래인구추계', note: '과거가 아니라 전망입니다. 가정에 따라 시나리오가 나뉩니다.' },
      { survey: '생명표', note: '기대수명의 출처. 사망 수준을 요약한 지표입니다.' },
    ],
  },
  {
    slug: 'housing-and-households',
    title: '집과 가구',
    subtitle: '주택 재고와 가구 구조는 함께 보아야 합니다',
    description:
      '“집이 부족하다”는 판단은 주택 수만으로 내릴 수 없습니다. 가구가 몇 개로 쪼개지고 있는지를 함께 봐야 합니다. 1인 가구 증가처럼 가구 구조의 변화가 주택 수요를 바꾸기 때문입니다.',
    tags: ['주거', '가구·가족'],
    items: [
      { survey: '주택총조사', note: '주택 재고의 기준 통계. 유형·건축연도·규모까지 담깁니다.' },
      { survey: '장래가구추계', note: '가구 수 전망. 주택 수요를 가늠하는 쪽은 인구보다 가구입니다.' },
      { survey: '신혼부부통계', note: '주거 이동이 가장 활발한 집단의 주택 소유·대출 실태.' },
    ],
  },
  {
    slug: 'business-cycle',
    title: '경기, 어디를 먼저 보나',
    subtitle: '종합지수와 부문별 동향조사의 역할 나누기',
    description:
      '경기를 볼 때는 요약 지표와 부문별 원자료를 함께 봐야 합니다. 종합지수는 방향을 빠르게 알려주지만 왜 그런지는 말해주지 않습니다. 그 이유는 제조업·서비스업·건설 각각의 동향조사에 있습니다.',
    tags: ['경기지표', '제조업', '서비스업', '건설'],
    items: [
      { survey: '경기종합지수', note: '선행·동행·후행. 경기 국면을 요약해 보여줍니다.' },
      { survey: '전산업생산지수', note: '경제 전체 생산 활동을 하나의 지수로 묶은 것.' },
      { survey: '광업제조업동향조사', note: '제조업 생산·출하·재고. 재고 증가는 흔히 경기 둔화 신호로 읽힙니다.' },
      { survey: '서비스업동향조사', note: '고용 비중이 가장 큰 부문. 내수를 볼 때 봅니다.' },
      { survey: '건설경기동향조사', note: '수주는 앞으로의 일감, 기성은 지금 진행 중인 공사입니다.' },
      { survey: '설비투자지수', note: '기업이 미래를 어떻게 보는지가 설비투자에 드러납니다.' },
    ],
  },
];

async function main() {
  const { data: stats, error } = await supabase
    .from('statistics')
    .select('id, stat_id, name_ko, status')
    .eq('status', 'active');
  if (error) throw error;

  const byStatId = new Map((stats ?? []).map((s) => [s.stat_id as string, s.id as string]));
  const byName = new Map((stats ?? []).map((s) => [s.name_ko as string, s.id as string]));
  /**
   * 조사명은 KOSIS 표기가 바뀌기도 합니다.
   *   '소비자물가조사' -> '소비자물가조사(2020=100)'
   *   '초중고사교육비조사' -> '초중고 사교육비조사'(공백)
   * 그래서 정확히 일치 -> stat_id -> 괄호·공백 무시 순으로 찾습니다.
   */
  const loose = (v: string) => v.replace(/\s+/g, '').replace(/\(.*?\)/g, '').toLowerCase();
  const byLoose = new Map((stats ?? []).map((s2) => [loose(s2.name_ko as string), s2.id as string]));
  const resolve = (survey: string) =>
    byName.get(survey) ?? byStatId.get(toStatId(survey)) ?? byLoose.get(loose(survey)) ?? null;

  let missing = 0;
  for (const set of SETS) {
    const found = set.items.filter((i) => resolve(i.survey));
    const lost = set.items.filter((i) => !resolve(i.survey));
    missing += lost.length;
    log.info(`${set.title} — 조사 ${found.length}/${set.items.length}건 연결`);
    lost.forEach((i) => log.warn(`   찾을 수 없음: ${i.survey}`));
  }
  if (DRY) {
    log.warn(`--dry-run 이므로 DB 를 수정하지 않았습니다. (연결 실패 ${missing}건)`);
    return;
  }

  for (const set of SETS) {
    const { data: up, error: upErr } = await supabase
      .from('curated_sets')
      .upsert(
        {
          slug: set.slug,
          title: set.title,
          subtitle: set.subtitle,
          description: set.description,
          curator_name: '통계나침반 편집',
          tags: set.tags,
          is_published: true,
          published_at: new Date().toISOString(),
        },
        { onConflict: 'slug' },
      )
      .select('id')
      .limit(1);
    if (upErr) throw upErr;
    const setId = up?.[0]?.id as string | undefined;
    if (!setId) { log.err(`세트 id 없음: ${set.slug}`); continue; }

    // 재실행 시 중복되지 않도록 항목을 비우고 다시 채웁니다
    const { error: delErr } = await supabase.from('curated_set_items').delete().eq('set_id', setId);
    if (delErr) throw delErr;

    const rows = set.items
      .map((i, idx) => {
        const sid = resolve(i.survey);
        return sid ? { set_id: setId, statistic_id: sid, position: idx, editor_note: i.note } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('curated_set_items').insert(rows);
      if (insErr) throw insErr;
    }
    log.ok(`${set.title} — 항목 ${rows.length}건 저장`);
  }

  const { count } = await supabase.from('curated_sets').select('id', { count: 'exact', head: true });
  log.ok(`완료 — 큐레이션 세트 ${count}건`);
}

main().catch((e) => { log.err('Fatal', e); process.exit(1); });
