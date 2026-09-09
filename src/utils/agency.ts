/**
 * 국가데이터처 부서명 복원.
 *
 * KOSIS OpenAPI 가 내려주는 작성기관(MAINC_NM)·문의처(writingTel) 값에는
 * '통계청 -> 국가데이터처' 일괄 치환 과정에서 생긴 손상이 섞여 있습니다.
 *
 *   국가데이터처용통계과      <- 고용통계과   (앞 글자 '고' 유실)
 *   국가데이터처비스업동향과   <- 서비스업동향과 (앞 글자 '서' 유실)
 *   국가데이터처 사회통계 ...  <- 사회통계국   (끝 글자 '국' 유실)
 *
 * 아래 부서 목록은 「국가데이터처_보유데이터_부서별 조사_통합본.xlsx」의
 * '구분' 시트에 있는 공식 조직도를 옮긴 것으로, 이 목록에 정확히 한 건만
 * 대응될 때에만 복원합니다. 애매하면 원문을 그대로 둡니다.
 */
export const DEPARTMENTS: readonly string[] = [
  "가계수지동향과",
  "감사담당관",
  "강원지방데이터지청",
  "경인지방데이터청",
  "경제동향통계심의관",
  "경제조사과",
  "경제총조사과",
  "경제통계국",
  "경제통계기획과",
  "경제통계심사조정과",
  "고용통계과",
  "공간정보서비스과",
  "교육기획과",
  "교육운영과",
  "국가데이터기획협력과",
  "국가데이터기획협력관",
  "국가데이터연구원",
  "국가데이터인재개발원",
  "국가데이터허브정책과",
  "국가데이터허브정책관",
  "국가데이터혁신과",
  "국제협력담당관",
  "기업통계팀",
  "기획재정담당관",
  "기획조정관",
  "농어업동향과",
  "농어업서비스업조사과",
  "농어업조사과",
  "농어업통계과",
  "데이터과학연구팀",
  "데이터방법연구실",
  "동남지방데이터청",
  "동북지방데이터청",
  "마이크로데이터과",
  "물가동향과",
  "법무민원팀",
  "복지통계과",
  "빅데이터통계과",
  "사회통계국",
  "사회통계기획과",
  "사회통계심사조정과",
  "산업동향과",
  "산업통계과",
  "서비스업동향과",
  "소득통계과",
  "소속특수법인설립추진단",
  "스마트조사센터",
  "연구기획실",
  "운영지원과",
  "인공지능통계혁신과",
  "인구동향과",
  "인구총조사과",
  "인구추계팀",
  "정책통계연구실",
  "조사관리국",
  "조사기획과",
  "조사시스템관리과",
  "지능정보화팀",
  "지역통계과",
  "지역통계기획팀",
  "충청지방데이터청",
  "통계기준과",
  "통계등록부과",
  "통계서비스국",
  "통계서비스기획과",
  "통계정책과",
  "통계정책국",
  "표본과",
  "품질관리과",
  "행정자료관리과",
  "행정통계과",
  "혁신행정담당관",
  "호남지방데이터청",
];

const ORG = "국가데이터처";
const DEPT_SET = new Set<string>(DEPARTMENTS);

/** 첫 글자가 유실된 형태 -> 정식 부서명. 후보가 둘 이상이면 제외합니다. */
const BY_HEAD_LOSS = (() => {
  const seen = new Map<string, string | null>();
  for (const d of DEPARTMENTS) {
    if (d.length < 3) continue;
    const tail = d.slice(1);
    if (DEPT_SET.has(tail)) continue; // 그 자체로 부서명이면 손상으로 볼 수 없음
    seen.set(tail, seen.has(tail) ? null : d);
  }
  const map = new Map<string, string>();
  for (const [k, v] of seen) if (v) map.set(k, v);
  return map;
})();

/** 끝 글자가 유실된 형태 -> 정식 부서명 (예: '사회통계' -> '사회통계국') */
const BY_TAIL_LOSS = (() => {
  const seen = new Map<string, string | null>();
  for (const d of DEPARTMENTS) {
    if (d.length < 3) continue;
    const head = d.slice(0, -1);
    if (DEPT_SET.has(head)) continue;
    seen.set(head, seen.has(head) ? null : d);
  }
  const map = new Map<string, string>();
  for (const [k, v] of seen) if (v) map.set(k, v);
  return map;
})();

/**
 * 기관/부서 표기를 복원합니다. 전화번호 등 괄호 뒷부분은 건드리지 않습니다.
 * 복원 근거가 없으면 입력을 그대로 돌려주므로 안전하게 덮어 쓸 수 있습니다.
 */
export function repairOrgName(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // '(☎ 042-...)' 처럼 괄호로 시작하는 꼬리는 분리해 두고 앞부분만 손봅니다.
  const m = raw.match(/^(.*?)(\s*[(（].*)$/);
  const head = (m ? m[1] : raw).trim();
  const tail = m ? m[2] : "";
  if (!head) return raw;

  const out: string[] = [];
  for (const token of head.split(/\s+/)) {
    if (token.startsWith(ORG) && token.length > ORG.length) {
      const rest = token.slice(ORG.length);
      if (DEPT_SET.has(rest)) {
        out.push(ORG, rest);
        continue;
      }
      const fixed = BY_HEAD_LOSS.get(rest);
      if (fixed) {
        out.push(ORG, fixed);
        continue;
      }
    }
    if (!DEPT_SET.has(token)) {
      const fixed = BY_TAIL_LOSS.get(token);
      if (fixed) {
        out.push(fixed);
        continue;
      }
    }
    out.push(token);
  }

  // 두 번째 이후에 반복되는 기관명은 제거 ('국가데이터처 사회통계국 국가데이터처 농어업동향과')
  const deduped = out.filter((t, i) => !(t === ORG && i > 0));
  return (deduped.join(" ") + tail).trim();
}
