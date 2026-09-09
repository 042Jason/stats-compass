-- AI 로 정제한 콘텐츠를 담을 칸.
-- 원문(raw_meta)은 그대로 두고, 정제본만 따로 보관합니다.
--   { overview, terms: [{term, plain}], cautions: [string], sources: [{title,url}], generated_at }
alter table public.statistics add column if not exists ai_content jsonb;

comment on column public.statistics.ai_content is
  'AI 정제 콘텐츠(조사 개요, 쉽게 푼 주요용어·유의사항). 원문은 raw_meta 에 그대로 보존됨';

select count(*) as 전체, count(ai_content) as ai_정제됨 from public.statistics where status = 'active';
