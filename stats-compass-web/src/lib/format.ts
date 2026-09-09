/** 'YYYY-MM-DD' / ISO / 'YYYY' / 'YYYYMM' 등을 한국어 표기로 */
export function formatDate(value: string | null | undefined, style: "long" | "short" = "long"): string {
  if (!value) return "";
  const s = String(value).trim();

  // YYYY
  if (/^\d{4}$/.test(s)) return `${s}년`;
  // YYYYMM
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}년 ${parseInt(s.slice(4), 10)}월`;
  // YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) return `${s.slice(0, 4)}년 ${parseInt(s.slice(5), 10)}월`;
  // YYYYQn
  const q = s.match(/^(\d{4})Q([1-4])$/i);
  if (q) return `${q[1]}년 ${q[2]}분기`;

  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { year: "numeric", month: "long", day: "numeric" }
      : { year: "numeric", month: "2-digit", day: "2-digit" };
  return new Intl.DateTimeFormat("ko-KR", { ...opts, timeZone: "Asia/Seoul" }).format(d);
}

/**
 * KOSIS 수록시점(latest_period) 표기를 한국어로.
 *
 * 실제 값 형태 (2026-09-09 statistic_tables 1,381건 확인):
 *   '2024'        연간
 *   '2025.08'     월    → 점 표기
 *   '202508'      월    → 붙임 표기
 *   '2026 1/2'    반기  → 상반기/하반기
 *   '2025 3/4'    분기
 *   '20250815'    일
 * 알 수 없는 표기는 원문을 그대로 돌려주므로 화면이 깨지지 않습니다.
 */
export function formatPeriod(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value).trim();
  if (!s) return "";

  // 2026 1/2 · 2026.1/2 · 2026-1/2  (반기)
  const half = s.match(/^(\d{4})\s*[.\-\s]?\s*([12])\s*\/\s*2$/);
  if (half) return `${half[1]}년 ${half[2] === "1" ? "상" : "하"}반기`;

  // 2025 3/4 (분기)
  const quarter = s.match(/^(\d{4})\s*[.\-\s]?\s*([1-4])\s*\/\s*4$/);
  if (quarter) return `${quarter[1]}년 ${quarter[2]}분기`;

  // 2025.08 · 2025-08 · 2025 08 (월)
  const dotMonth = s.match(/^(\d{4})[.\-\s](\d{1,2})$/);
  if (dotMonth) {
    const m = parseInt(dotMonth[2], 10);
    if (m >= 1 && m <= 12) return `${dotMonth[1]}년 ${m}월`;
  }

  // 20250815 (일)
  const day = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (day) {
    const mm = parseInt(day[2], 10);
    const dd = parseInt(day[3], 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${day[1]}년 ${mm}월 ${dd}일`;
  }

  // 그 외(2024 · 202508 · 2024Q2 등)는 공통 날짜 포맷터에 위임
  return formatDate(s, "short");
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return new Intl.NumberFormat("ko-KR").format(n);
}

/** 문자열 앞부분 요약 */
export function truncate(text: string | null | undefined, max = 120): string {
  if (!text) return "";
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 작성주기 코드/문자열을 보기 좋은 라벨로 */
export function frequencyLabel(value: string | null | undefined): string {
  if (!value) return "";
  const map: Record<string, string> = {
    Y: "연간",
    YEAR: "연간",
    ANNUAL: "연간",
    Q: "분기",
    QUARTER: "분기",
    M: "월간",
    MONTH: "월간",
    W: "주간",
    D: "일간",
    "5Y": "5년",
    "2Y": "2년",
    "3Y": "3년",
    IR: "부정기",
  };
  return map[value.toUpperCase()] ?? value;
}
