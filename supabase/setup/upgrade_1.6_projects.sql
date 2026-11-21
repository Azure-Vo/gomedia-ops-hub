-- =====================================================================================
-- Go Media Ops Hub · upgrade 1.5 → 1.6 (S1 · Dự án & Task, docs/PRD-1.6-du-an-va-task.md)
-- Adds columns, tables, a view and a storage bucket. No table, column or row is dropped; existing
-- Lark parent tasks become projects and their sub-tasks become tasks (backfilled below).
-- Safe to run more than once. Running 01_schema.sql 1.6 in full does the same.
-- =====================================================================================
begin;

-- ---------------------------------------------------------------------------- settings --------
alter table public.settings
  add column if not exists summary_morning_time text not null default '08:30' check (summary_morning_time ~ '^\d{2}:\d{2}$'),
  add column if not exists summary_evening_time text not null default '17:30' check (summary_evening_time ~ '^\d{2}:\d{2}$'),
  add column if not exists summary_evening_on boolean not null default true;

-- ---------------------------------------------- projects (kind = parent) and tasks (child) --------
alter table public.lark_tasks
  add column if not exists state text,
  add column if not exists seq int,
  add column if not exists next_seq int not null default 1,
  add column if not exists client text,
  add column if not exists start_date date,
  add column if not exists color text,
  add column if not exists pm_id uuid references public.profiles(id) on delete set null,
  add column if not exists chat_id text,
  add column if not exists chat_name text,
  add column if not exists chat_status text not null default 'none',
  add column if not exists chat_warned_at timestamptz,
  add column if not exists assignee_id uuid references public.profiles(id) on delete set null,
  add column if not exists expected_output text,
  add column if not exists original_due_date date,
  add column if not exists kpi_due_date date,
  add column if not exists tier text,
  add column if not exists progress text,
  add column if not exists progress_note text,
  add column if not exists progress_at timestamptz,
  add column if not exists review_since timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz;

-- Backfill rows created before 1.6 (only rows that have no state yet).
update public.lark_tasks set
  state = case when closed_at is not null then 'done' else 'active' end,
  start_date = least((created_at at time zone 'Asia/Ho_Chi_Minh')::date, due_date - 1),
  original_due_date = due_date,
  kpi_due_date = due_date,
  pm_id = coalesce(
    (select lp.profile_id from public.lark_people lp join public.profiles pr on pr.id = lp.profile_id where lp.open_id = lark_tasks.assignee_open_id and pr.role = 'pm'),
    created_by)
where kind = 'parent' and state is null;

update public.lark_tasks t set
  state = case when t.closed_at is not null then 'done' when t.completed_at is not null then 'review' else 'doing' end,
  start_date = least((t.created_at at time zone 'Asia/Ho_Chi_Minh')::date, t.due_date - 1),
  original_due_date = t.due_date,
  kpi_due_date = t.due_date,
  assignee_id = (select lp.profile_id from public.lark_people lp where lp.open_id = t.assignee_open_id),
  accepted_at = case when t.closed_at is not null then t.completed_at end,
  approved_at = t.closed_at,
  review_since = case when t.closed_at is null and t.completed_at is not null then t.completed_at end
where t.kind = 'child' and t.state is null;

update public.lark_tasks t set seq = n.rn
from (select id, row_number() over (partition by parent_id order by created_at, code) as rn from public.lark_tasks where kind = 'child') n
where t.id = n.id and t.seq is null;

update public.lark_tasks p set next_seq = greatest(p.next_seq, coalesce((select max(c.seq) from public.lark_tasks c where c.parent_id = p.id), 0) + 1)
where p.kind = 'parent';

alter table public.lark_tasks alter column state set default 'doing';
alter table public.lark_tasks alter column start_date set default current_date;
update public.lark_tasks set state = 'doing' where state is null;
update public.lark_tasks set start_date = due_date - 1 where start_date is null;
update public.lark_tasks set original_due_date = due_date where original_due_date is null;
update public.lark_tasks set kpi_due_date = due_date where kpi_due_date is null;
alter table public.lark_tasks alter column state set not null;
alter table public.lark_tasks alter column start_date set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lark_tasks_state_ck') then
    alter table public.lark_tasks add constraint lark_tasks_state_ck check (
      (kind = 'parent' and state in ('active','done','cancelled')) or
      (kind = 'child' and state in ('doing','review','changes','done','cancelled')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lark_tasks_chat_status_ck') then
    alter table public.lark_tasks add constraint lark_tasks_chat_status_ck check (chat_status in ('none','linked','missing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lark_tasks_tier_ck') then
    alter table public.lark_tasks add constraint lark_tasks_tier_ck check (tier is null or tier in ('short','medium','long'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lark_tasks_progress_ck') then
    alter table public.lark_tasks add constraint lark_tasks_progress_ck check (progress is null or progress in ('on_plan','behind','blocked'));
  end if;
end $$;
create unique index if not exists lark_tasks_seq_uq on public.lark_tasks (parent_id, seq) where kind = 'child';
create index if not exists lark_tasks_assignee_idx on public.lark_tasks (assignee_id) where kind = 'child';
create index if not exists lark_tasks_pm_idx on public.lark_tasks (pm_id) where kind = 'parent';

-- -------------------------------------------------------------------- project members (5.3) --------
-- Members come from the project's Lark group (synced), from task assignment, or are picked by the PM
-- in simulation. A Lark member without an Ops Hub account has open_id but no profile_id.
create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lark_tasks(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  open_id text,
  name text not null default '',
  source text not null default 'manual' check (source in ('group','task','manual')),
  created_at timestamptz not null default now(),
  check (profile_id is not null or open_id is not null)
);
create unique index if not exists project_members_uq on public.project_members (project_id, (coalesce(profile_id::text, open_id)));
create index if not exists project_members_profile_idx on public.project_members (profile_id);

insert into public.project_members (project_id, profile_id, open_id, name, source)
select distinct on (c.parent_id, coalesce(c.assignee_id::text, c.assignee_open_id)) c.parent_id, c.assignee_id, c.assignee_open_id, coalesce(c.assignee_name, ''), 'task'
from public.lark_tasks c
where c.kind = 'child' and c.parent_id is not null and (c.assignee_id is not null or c.assignee_open_id is not null)
on conflict do nothing;

-- -------------------------------------------------------------- submissions and review (6.4) --------
create table if not exists public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.lark_tasks(id) on delete cascade,
  round int not null,
  via text not null default 'web' check (via in ('web','lark')),
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  note text,
  links jsonb not null default '[]',
  files jsonb not null default '[]',
  decision text check (decision in ('approved','changes')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  feedback text,
  unique (task_id, round)
);

insert into public.task_submissions (task_id, round, via, submitted_at, decision, decided_at)
select t.id, 1, 'lark', t.completed_at, case when t.closed_at is not null then 'approved' end, t.closed_at
from public.lark_tasks t
where t.kind = 'child' and t.completed_at is not null
on conflict (task_id, round) do nothing;

-- Deadline changes of tasks and projects, with the reason (scope moves the KPI deadline, quality does not).
create table if not exists public.task_extensions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.lark_tasks(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text not null check (reason in ('scope','quality')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists task_extensions_task_idx on public.task_extensions (task_id, created_at);

-- Progress questions (7.2): one row per task and point (50 / 75).
create table if not exists public.task_checkins (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.lark_tasks(id) on delete cascade,
  pct int not null check (pct between 1 and 99),
  due_date date not null,
  sent_at timestamptz,
  answer text check (answer in ('on_plan','behind','blocked')),
  answer_reason text,
  answered_at timestamptz,
  unique (task_id, pct)
);

-- -------------------------------------------------------------------------- bot messages (7.5) --------
-- Every message of 1.6 (group or direct), with a unique key that stops a second send of the same thing.
create table if not exists public.bot_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.lark_tasks(id) on delete cascade,
  task_id uuid references public.lark_tasks(id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('group','dm')),
  chat_id text,
  to_open_id text,
  to_name text,
  dedupe_key text unique,
  local_date date not null,
  status text not null check (status in ('sent','simulated','failed')),
  attempts int not null default 1,
  last_error text,
  message jsonb not null,
  lark_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bot_messages_date_idx on public.bot_messages (local_date desc);
create index if not exists bot_messages_project_idx on public.bot_messages (project_id, created_at desc);

-- Lark groups the bot is in (live: listed from Lark; simulation: created by the PM).
create table if not exists public.lark_chats (
  chat_id text primary key,
  name text not null default '',
  mode text not null default 'live' check (mode in ('simulation','live')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------------ access --------
-- PM, CEO and Admin see every project; anyone else sees the projects they are a member of or have a task in.
create or replace function public.ops_project_visible(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('pm','ceo','admin')
      or exists (select 1 from public.project_members m where m.project_id = p and m.profile_id = auth.uid())
      or exists (select 1 from public.lark_tasks c where c.parent_id = p and c.kind = 'child' and c.assignee_id = auth.uid())
$$;
create or replace function public.ops_task_project(t uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when kind = 'parent' then id else parent_id end from public.lark_tasks where id = t
$$;
revoke all on function public.ops_project_visible(uuid) from public, anon;
revoke all on function public.ops_task_project(uuid) from public, anon;
grant execute on function public.ops_project_visible(uuid) to authenticated, service_role;
grant execute on function public.ops_task_project(uuid) to authenticated, service_role;

drop policy if exists lark_tasks_read on public.lark_tasks;
create policy lark_tasks_read on public.lark_tasks for select to authenticated
  using (public.app_role() is not null and public.ops_project_visible(case when kind = 'parent' then id else parent_id end));

alter table public.project_members enable row level security;
alter table public.task_submissions enable row level security;
alter table public.task_extensions enable row level security;
alter table public.task_checkins enable row level security;
alter table public.bot_messages enable row level security;
alter table public.lark_chats enable row level security;

drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members for select to authenticated using (public.ops_project_visible(project_id));
drop policy if exists task_submissions_read on public.task_submissions;
create policy task_submissions_read on public.task_submissions for select to authenticated using (public.ops_project_visible(public.ops_task_project(task_id)));
drop policy if exists task_extensions_read on public.task_extensions;
create policy task_extensions_read on public.task_extensions for select to authenticated using (public.ops_project_visible(public.ops_task_project(task_id)));
drop policy if exists task_checkins_read on public.task_checkins;
create policy task_checkins_read on public.task_checkins for select to authenticated using (public.ops_project_visible(public.ops_task_project(task_id)));
-- Direct messages are visible to their recipient and to PM / CEO / Admin only.
drop policy if exists bot_messages_read on public.bot_messages;
create policy bot_messages_read on public.bot_messages for select to authenticated using (
  public.app_role() in ('pm','ceo','admin')
  or (channel = 'group' and project_id is not null and public.ops_project_visible(project_id))
  or to_open_id in (select open_id from public.lark_people where profile_id = auth.uid()));
drop policy if exists lark_chats_read on public.lark_chats;
create policy lark_chats_read on public.lark_chats for select to authenticated using (public.app_role() in ('pm','ceo','admin'));

revoke all on public.project_members, public.task_submissions, public.task_extensions, public.task_checkins, public.bot_messages, public.lark_chats from anon, authenticated;
grant select on public.project_members, public.task_submissions, public.task_extensions, public.task_checkins, public.bot_messages, public.lark_chats to authenticated;
grant all on public.project_members, public.task_submissions, public.task_extensions, public.task_checkins, public.bot_messages, public.lark_chats to service_role;
grant update (summary_morning_time, summary_evening_time, summary_evening_on) on public.settings to authenticated;

-- Go Star and the KPI dashboard count every person's tasks, including projects the viewer is not in:
-- this view gives signed-in users the few columns needed for that and nothing else.
create or replace view public.task_kpi_facts as
  select t.id, t.assignee_open_id, t.assignee_id, t.assignee_name, t.kpi_due_date, t.due_date, t.state, t.accepted_at,
         (select s.submitted_at from public.task_submissions s where s.task_id = t.id and s.decision is null order by s.round desc limit 1) as pending_at
  from public.lark_tasks t
  where t.kind = 'child' and t.deleted_at is null and public.app_role() is not null;
revoke all on public.task_kpi_facts from anon, public;
grant select on public.task_kpi_facts to authenticated, service_role;

drop trigger if exists audit_row on public.task_submissions;
create trigger audit_row after insert or update or delete on public.task_submissions for each row execute function public.audit_row();
drop trigger if exists audit_row on public.project_members;
create trigger audit_row after insert or update or delete on public.project_members for each row execute function public.audit_row();

-- Evidence files (6.4): private bucket; the Edge Function hands out signed upload / download links after
-- checking who is asking. Only on Supabase (plain Postgres test databases have no storage schema).
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit) values ('task-evidence', 'task-evidence', false, 20971520)
    on conflict (id) do nothing;
  end if;
end $$;

commit;
