-- =====================================================================================
-- Go Media Ops Hub · remove the synthetic sample data from a project (Pilot or Demo)
-- Run in Supabase → SQL Editor BEFORE the real pilot starts, so KPIs and the Diagnostics
-- baseline only use Go Media's own data. Removes: the 6 sample people (@demo.gomedia.example.com)
-- with their tasks (milestones, checkpoints, alerts cascade) and quotes (lines, approvals cascade),
-- every quote coded DEMO-*, and the pilot dates the sample set. Keeps the price library,
-- quote terms, settings, real users and their data.
-- =====================================================================================
begin;
delete from public.tasks where owner_id in (select id from public.profiles where email like '%@demo.gomedia.example.com');
delete from public.quotes where code like 'DEMO-%'
   or created_by in (select id from public.profiles where email like '%@demo.gomedia.example.com');
delete from auth.users where email like '%@demo.gomedia.example.com';
update public.settings set pilot_start = null, pilot_end = null where id = 1;
commit;
select (select count(*) from public.quotes) quotes, (select count(*) from public.tasks) tasks,
       (select count(*) from public.profiles) people, (select count(*) from public.library_items) library;
