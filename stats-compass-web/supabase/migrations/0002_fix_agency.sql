-- 0002_fix_agency.sql
-- KOSIS MAINC_NM 손상(통계청 -> 국가데이터처 일괄 치환 시 부서명 첫 글자 유실) 복구.
-- 정식 부서명은 「국가데이터처_보유데이터_부서별 조사_통합본.xlsx」의 '구분' 시트 기준.
-- 재실행해도 안전합니다(이미 고쳐진 행은 매칭되지 않음).

begin;

update public.statistics set agency = '국가데이터처 서비스업동향과' where agency = '국가데이터처비스업동향과';
update public.statistics set agency = '국가데이터처 사회통계기획과' where agency = '국가데이터처회통계기획과';
update public.statistics set agency = '국가데이터처 경제통계기획과' where agency = '국가데이터처제통계기획과';
update public.statistics set agency = '국가데이터처 인구총조사과' where agency = '국가데이터처구총조사과';
update public.statistics set agency = '국가데이터처 농어업동향과' where agency = '국가데이터처어업동향과';
update public.statistics set agency = '국가데이터처 고용통계과' where agency = '국가데이터처용통계과';
update public.statistics set agency = '국가데이터처 행정통계과' where agency = '국가데이터처정통계과';
update public.statistics set agency = '국가데이터처 산업동향과' where agency = '국가데이터처업동향과';
update public.statistics set agency = '국가데이터처 인구추계팀' where agency = '국가데이터처구추계팀';
update public.statistics set agency = '국가데이터처 산업통계과' where agency = '국가데이터처업통계과';
update public.statistics set agency = '국가데이터처 인구동향과' where agency = '국가데이터처구동향과';

-- 복구 결과 확인
select agency, count(*) from public.statistics group by agency order by count(*) desc;

commit;
