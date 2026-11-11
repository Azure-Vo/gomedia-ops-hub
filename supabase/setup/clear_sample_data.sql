-- =====================================================================================
-- Go Media Ops Hub · remove the prototype showcase data from a project (Pilot or Demo)
-- Run in Supabase → SQL Editor BEFORE the real pilot starts, so KPIs and the Diagnostics
-- baseline only use Go Media's own data.
--
-- Every row created by tools/showcase/generate.ts is listed in public.seed_registry (people,
-- quotes, price-library items it added, S1 Lark tasks and their reminders, the old checkpoint
-- tasks). This script deletes those rows, plus the older sample set (@demo.gomedia.example.com,
-- DEMO-* quotes, Lark tasks named "(mẫu)") if it is still there, and clears the pilot dates.
-- Keeps: the CEO's 23 library items, quote terms, settings, real users and their data.
-- Library items the showcase added are kept if a real quote uses them.
-- =====================================================================================
begin;
create table if not exists public.seed_registry (table_name text not null, row_id text not null, created_at timestamptz not null default now(), primary key (table_name, row_id));

-- quotes (lines and approvals cascade) and tasks (milestones, checkpoints, alerts cascade)
delete from public.quotes where id::text in (select row_id from public.seed_registry where table_name = 'quotes')
   or code like 'DEMO-%'
   or created_by in (select row_id::uuid from public.seed_registry where table_name = 'auth.users')
   or created_by in (select id from public.profiles where email like '%@demo.gomedia.example.com');
delete from public.tasks where id::text in (select row_id from public.seed_registry where table_name = 'tasks')
   or owner_id in (select row_id::uuid from public.seed_registry where table_name = 'auth.users')
   or owner_id in (select id from public.profiles where email like '%@demo.gomedia.example.com');
-- S1 Lark tasks (reminders cascade)
delete from public.lark_tasks where id::text in (select row_id from public.seed_registry where table_name = 'lark_tasks')
   or name like '%(mẫu)%';
-- Go Star scores and closed months entered for the showcase
delete from public.gostar_scores where month || '|' || open_id in (select row_id from public.seed_registry where table_name = 'gostar_scores');
delete from public.gostar_months where month in (select row_id from public.seed_registry where table_name = 'gostar_months');
-- price-library items added for the showcase, unless a remaining quote uses them
delete from public.library_items li where li.id::text in (select row_id from public.seed_registry where table_name = 'library_items')
   and not exists (select 1 from public.quote_lines l where l.library_item_id = li.id);
-- people
delete from public.lark_people where profile_id in (select row_id::uuid from public.seed_registry where table_name = 'auth.users');
delete from auth.users where id::text in (select row_id from public.seed_registry where table_name = 'auth.users')
   or email like '%@demo.gomedia.example.com';
delete from public.lark_people where open_id like 'sim:%' and profile_id is null;

update public.settings set pilot_start = null, pilot_end = null, lark_status = '{}' where id = 1;
delete from public.seed_registry;
commit;

select (select count(*) from public.quotes) quotes, (select count(*) from public.tasks) tasks,
       (select count(*) from public.lark_tasks) lark_tasks, (select count(*) from public.profiles) people,
       (select count(*) from public.library_items) library;
