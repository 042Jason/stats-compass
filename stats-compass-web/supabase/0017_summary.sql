-- ============================================================================
-- 0017_summary.sql — 카드용 한 줄 개요
--
-- 왜 새 칸을 만드는가
--   목록 카드에는 지금 purpose(작성목적 원문)를 잘라서 씁니다. 그런데
--     · 원문이 없는 조사가 있고 (서비스업조사 등)
--     · 있는 것은 "ㅇ 정부의 경제정책과 기업의 경영계획 수립 등에 필요한…" 처럼
--       행정 문서 말투라 카드 두 줄에 안 맞습니다.
--
--   purpose 를 덮어쓰면 원문이 사라집니다. 상세 페이지에서는 원문을 그대로
--   보여 줘야 하므로, 카드용 문장은 별도 칸에 둡니다. 원본은 손대지 않습니다.
--
-- 채우는 방법
--   npx tsx src/seed/21_applySurveyMeta.ts --apply
--   CSV 의 작성목적을 LLM 이 두 줄로 줄여 넣습니다.
-- ============================================================================

alter table public.statistics
  add column if not exists summary text;

comment on column public.statistics.summary is
  '목록 카드용 한 줄 개요(80자 내외). 작성목적 원문을 줄인 것이며 원문은 purpose 에 그대로 둡니다.';

notify pgrst, 'reload schema';
