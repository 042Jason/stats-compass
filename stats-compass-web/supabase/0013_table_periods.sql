-- ============================================================================
-- 0013_table_periods.sql — 통계표 수록 주기·시작시점 보관
--
-- 왜 필요한가
--   05_fetchPeriods.ts 는 KOSIS 수록정보(getMeta type=PRD)를 이미 부르고 있고
--   응답에는 셋이 다 옵니다.
--
--     [{ "PRD_SE": "년", "STRT_PRD_DE": "2016", "END_PRD_DE": "2024" }]
--
--   그런데 저장은 END 하나(latest_period)만 하고 주기와 시작시점을 버렸습니다.
--   그 탓에 화면에서 "이 표는 연간인가 월간인가" 를 알 수 없어,
--   KOSIS 를 부를 때마다 주기를 추측하거나 메타를 다시 읽어야 했습니다.
--
--   세 개를 다 두면 통계표마다 맞는 주기로 바로 부를 수 있습니다.
--   호출도 표당 3회에서 1회로 줄어듭니다.
--
-- 주의
--   prd_se 에는 <코드>(Y/H/Q/M/D/F/IR)를 넣습니다. KOSIS 는 한글("년")로 주지만
--   getList 의 prdSe 파라미터는 코드를 받습니다. 변환은 05 스크립트가 합니다.
-- ============================================================================

alter table public.statistic_tables
  add column if not exists prd_se       text,   -- 수록주기 코드 (Y/H/Q/M/D/F/IR)
  add column if not exists first_period text;   -- 수록 시작시점 (STRT_PRD_DE)

comment on column public.statistic_tables.prd_se is
  '수록주기 코드. KOSIS getList 의 prdSe 에 그대로 넣습니다. Y=연 H=반기 Q=분기 M=월 D=일 F=다년 IR=부정기';
comment on column public.statistic_tables.first_period is
  '수록 시작시점(STRT_PRD_DE). latest_period 와 짝입니다.';

notify pgrst, 'reload schema';
