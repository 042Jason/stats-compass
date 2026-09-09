import {
  Users,
  Briefcase,
  Landmark,
  HeartPulse,
  GraduationCap,
  Leaf,
  Wheat,
  Fish,
  Factory,
  Building2,
  HardHat,
  TrainFront,
  Coins,
  Wallet,
  ShoppingCart,
  Home,
  Globe2,
  ShieldCheck,
  FlaskConical,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface CategoryMeta {
  label: string;
  icon: LucideIcon;
  /** 카드 아이콘 배경/글자색 (tailwind) */
  tone: string;
  description: string;
}

/**
 * 카테고리 표기 메타.
 *
 * 키는 `normalizeKey()` 를 거친 값(가운뎃점·공백 제거, 소문자)입니다.
 * 상단 블록은 실제 시드 데이터(data/seed/03_statistics.json, 107건)에서 확인된
 * category 15종이고, 하단 블록은 분류 체계가 바뀌어도 대응되도록 남겨둔 별칭입니다.
 * 매칭되는 키가 없어도 기본 스타일로 표시되므로 화면이 깨지지 않습니다.
 *
 * DB 값의 가운뎃점은 U+318D('ㆍ')이며 U+00B7('·')가 아닙니다.
 * normalizeKey 가 둘 다 제거하므로 여기서는 신경 쓰지 않아도 됩니다.
 */
const CATEGORY_META: Record<string, CategoryMeta> = {
  /* --- 실제 DB category 15종 --- */
  노동: { label: "노동", icon: Briefcase, tone: "bg-amber-50 text-amber-700", description: "고용·임금·근로조건" },
  인구: { label: "인구", icon: Users, tone: "bg-sky-50 text-sky-700", description: "인구·가구·이동·출생·사망" },
  농림: { label: "농림", icon: Wheat, tone: "bg-lime-50 text-lime-700", description: "농업·임업" },
  주거: { label: "주거", icon: Home, tone: "bg-cyan-50 text-cyan-700", description: "주택·주거실태" },
  사회일반: { label: "사회일반", icon: Users, tone: "bg-violet-50 text-violet-700", description: "복지·문화·여가·안전·생활" },
  도소매서비스: { label: "도소매·서비스", icon: ShoppingCart, tone: "bg-pink-50 text-pink-700", description: "도소매업·서비스업 활동" },
  소득소비자산: { label: "소득·소비·자산", icon: Wallet, tone: "bg-emerald-50 text-emerald-700", description: "가계소득·소비지출·자산" },
  교육훈련: { label: "교육·훈련", icon: GraduationCap, tone: "bg-indigo-50 text-indigo-700", description: "학교·학생·교원·직업훈련" },
  광업제조업: { label: "광업·제조업", icon: Factory, tone: "bg-orange-50 text-orange-700", description: "광업·제조업 생산과 실태" },
  국민계정: { label: "국민계정", icon: Landmark, tone: "bg-blue-50 text-blue-700", description: "GDP·국부·위성계정" },
  경제일반경기: { label: "경제일반·경기", icon: Coins, tone: "bg-teal-50 text-teal-700", description: "경기종합지수·기업경기" },
  물가: { label: "물가", icon: Coins, tone: "bg-emerald-50 text-emerald-700", description: "소비자·생산자 물가" },
  건설: { label: "건설", icon: HardHat, tone: "bg-yellow-50 text-yellow-700", description: "건설수주·기성·건설업 실태" },
  보건: { label: "보건", icon: HeartPulse, tone: "bg-rose-50 text-rose-700", description: "건강·의료·사망원인" },
  수산: { label: "수산", icon: Fish, tone: "bg-blue-50 text-blue-700", description: "어업·수산물 생산" },

  /* --- 별칭 / 향후 분류 대응 --- */
  인구가구: { label: "인구·가구", icon: Users, tone: "bg-sky-50 text-sky-700", description: "인구·가구·이동·출생·사망" },
  사회: { label: "사회", icon: Users, tone: "bg-violet-50 text-violet-700", description: "복지·문화·여가·안전·생활" },
  고용노동임금: { label: "고용·노동·임금", icon: Briefcase, tone: "bg-amber-50 text-amber-700", description: "고용·임금·근로조건" },
  경제: { label: "경제", icon: Coins, tone: "bg-emerald-50 text-emerald-700", description: "물가·소득·소비·기업" },
  보건사회복지: { label: "보건·사회·복지", icon: HeartPulse, tone: "bg-rose-50 text-rose-700", description: "건강·의료·복지" },
  교육: { label: "교육", icon: GraduationCap, tone: "bg-indigo-50 text-indigo-700", description: "학교·학생·교원" },
  환경: { label: "환경", icon: Leaf, tone: "bg-green-50 text-green-700", description: "대기·수질·폐기물·에너지" },
  농림어업: { label: "농림어업", icon: Wheat, tone: "bg-lime-50 text-lime-700", description: "농업·임업·어업" },
  어업: { label: "어업", icon: Fish, tone: "bg-blue-50 text-blue-700", description: "어업·수산물 생산" },
  산업: { label: "산업", icon: Factory, tone: "bg-orange-50 text-orange-700", description: "광업·제조업·서비스업" },
  기업: { label: "기업", icon: Building2, tone: "bg-slate-100 text-slate-700", description: "사업체·기업활동" },
  국토: { label: "국토", icon: Building2, tone: "bg-cyan-50 text-cyan-700", description: "주택·건설·토지" },
  건설주택토지: { label: "건설·주택·토지", icon: HardHat, tone: "bg-yellow-50 text-yellow-700", description: "건설·주택·토지" },
  교통: { label: "교통", icon: TrainFront, tone: "bg-teal-50 text-teal-700", description: "교통·물류·통신" },
  교통물류: { label: "교통·물류", icon: TrainFront, tone: "bg-teal-50 text-teal-700", description: "교통·물류·통신" },
  재정: { label: "재정", icon: Landmark, tone: "bg-blue-50 text-blue-700", description: "정부재정·조세" },
  무역: { label: "무역", icon: Globe2, tone: "bg-fuchsia-50 text-fuchsia-700", description: "수출입·국제수지" },
  안전: { label: "안전", icon: ShieldCheck, tone: "bg-red-50 text-red-700", description: "범죄·재난·안전" },
  과학기술: { label: "과학·기술", icon: FlaskConical, tone: "bg-purple-50 text-purple-700", description: "연구개발·정보통신" },
  기타: { label: "기타", icon: Sparkles, tone: "bg-slate-100 text-slate-700", description: "기타 분야" },
};

const DEFAULT_META: Omit<CategoryMeta, "label"> = {
  icon: Sparkles,
  tone: "bg-slate-100 text-slate-700",
  description: "",
};

/** 가운뎃점(·, ㆍ, ・)·공백·구분자를 제거해 비교용 키로 */
function normalizeKey(category: string): string {
  return category.replace(/[\s·ㆍ・/,\-]/g, "").toLowerCase();
}

/**
 * 부분 일치 후보. 긴 키부터 검사해야 '건설' 이 '건설·주택·토지' 를 가로채지 않습니다.
 * 2글자 미만 키는 오매칭이 잦아 부분 일치 대상에서 제외합니다.
 */
const PARTIAL_KEYS = Object.keys(CATEGORY_META)
  .filter((k) => k.length >= 2)
  .sort((a, b) => b.length - a.length);

export function getCategoryMeta(category: string | null | undefined): CategoryMeta {
  if (!category) return { label: "미분류", ...DEFAULT_META };
  const key = normalizeKey(category);
  const hit = CATEGORY_META[key];
  if (hit) return { ...hit, label: category };
  // 부분 일치 (예: '인구·가구·주택' → '인구가구')
  const partial = PARTIAL_KEYS.find((k) => key.startsWith(k) || key.includes(k));
  if (partial) return { ...CATEGORY_META[partial], label: category };
  return { label: category, ...DEFAULT_META };
}

/** 실제 DB 에서 확인된 category 목록 (필터 UI 기본값 참고용) */
export const KNOWN_CATEGORIES = [
  "노동",
  "인구",
  "농림",
  "주거",
  "사회일반",
  "도소매ㆍ서비스",
  "소득ㆍ소비ㆍ자산",
  "교육ㆍ훈련",
  "광업ㆍ제조업",
  "국민계정",
  "경제일반ㆍ경기",
  "물가",
  "건설",
  "보건",
  "수산",
] as const;
