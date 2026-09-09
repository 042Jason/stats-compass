-- ---------------------------------------------------------------------------
-- 1) 소비자물가조사 중복 통합
--    stat_id=101_J17 은 재그룹핑 이전의 옛 행입니다. 붙어 있던 통계표를
--    정식 행으로 옮기고 옛 행은 merged 로 내립니다.
-- ---------------------------------------------------------------------------
update public.statistic_tables t
set    statistic_id = (select id from public.statistics where stat_id = '소비자물가조사' limit 1)
where  t.statistic_id = (select id from public.statistics where stat_id = '101_J17' limit 1);

update public.statistics set status = 'merged' where stat_id = '101_J17';

-- ---------------------------------------------------------------------------
-- 2) PostgREST 스키마 캐시 새로고침
--    search_all() 을 만들었는데도 anon 으로는 "function not found" 가 나는 이유입니다.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3) 확인 — 손상 판정은 LIKE 대신 정규식으로 해야 합니다.
--    LIKE '국가데이터처_%' 의 _ 는 '아무 글자 하나' 라서 복원된 값(공백)까지 잡힙니다.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.statistics where agency ~ '^국가데이터처[^ ]') as agency_손상,
  (select count(*) from public.statistics where status = 'active')            as active_조사,
  (select count(*) from public.curated_sets)                                  as 큐레이션_세트,
  (select count(*) from public.search_all('인구', 40))                        as search_all_동작;
