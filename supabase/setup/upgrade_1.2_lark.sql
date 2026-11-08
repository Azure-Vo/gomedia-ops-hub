-- =====================================================================================
-- Go Media Ops Hub · upgrade 1.1 → 1.2 (S1 reminders on Lark). Adds tables and settings only;
-- no drops, no change to existing data. Running 01_schema.sql 1.2 in full does the same.
-- =====================================================================================
begin;

-- ============================================================================================
-- 1.2 · S1 on Lark (brief A2.3): staff create parent / sub-tasks through the Lark bot, Lark Tasks
-- stores them, and the bot reminds the group at D-3, D-2, D-1 and from D+1 at 09:00 until the
-- sub-task is Completed with valid codes. These tables mirror Lark and keep the reminder history.
-- All writes go through the Edge Function (service role); signed-in users only read.
-- ============================================================================================
alter table public.settings
  add column if not exists lark_mode text not null default 'simulation' check (lark_mode in ('simulation','live')),
  add column if not exists lark_api_base text not null default 'https://open.larksuite.com',
  add column if not exists lark_app_id text not null default '',
  add column if not exists lark_chat_id text not null default '',
  add column if not exists lark_parent_pattern text not null default '^[A-Z]{2}\d{3}$',
  add column if not exists lark_child_pattern text not null default '^{PARENT}-\d{2}-S\d{2}$',
  add column if not exists lark_parent_example text not null default 'DA056',
  add column if not exists lark_child_example text not null default 'DA056-04-S44',
  add column if not exists lark_notify_d0 boolean not null default false,
  add column if not exists lark_notify_time text not null default '09:00' check (lark_notify_time ~ '^\d{2}:\d{2}$'),
  add column if not exists lark_status jsonb not null default '{}';

-- People the bot can tag. Live: Lark open_id (ou_…), learnt from messages and @mentions.
-- Simulation: "sim:<profile id>" for each Ops Hub user.
create table if not exists public.lark_people (
  open_id text primary key,
  name text not null default '',
  profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.lark_tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('parent','child')),
  parent_id uuid references public.lark_tasks(id) on delete cascade,
  code text not null,
  parent_code text,
  name text not null,
  description text,
  assignee_open_id text,
  assignee_name text,
  due_date date not null,
  mode text not null check (mode in ('simulation','live')),
  lark_guid text unique,
  lark_url text,
  lark_title text,
  completed_at timestamptz,
  closed_at timestamptz,
  deleted_at timestamptz,
  code_errors jsonb not null default '[]',
  source text not null default 'bot' check (source in ('bot','web')),
  created_by_open_id text,
  created_by uuid references public.profiles(id) on delete set null,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'parent') = (parent_id is null))
);
create unique index if not exists lark_tasks_code_uq on public.lark_tasks (upper(code)) where deleted_at is null;
create index if not exists lark_tasks_open_idx on public.lark_tasks (kind) where closed_at is null and deleted_at is null;

-- One row per task, day and kind: the unique key is what stops a second message the same day,
-- including after a restart. Failed sends are retried on later runs (attempts).
create table if not exists public.lark_notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.lark_tasks(id) on delete cascade,
  local_date date not null,
  kind text not null check (kind in ('reminder','completion')),
  milestone text,
  assignee_open_id text,
  status text not null check (status in ('sent','simulated','failed')),
  attempts int not null default 1,
  last_error text,
  message jsonb not null,
  lark_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, local_date, kind)
);
create index if not exists lark_notifications_date_idx on public.lark_notifications (local_date desc);

-- Bot previews waiting for "Xác nhận tạo".
create table if not exists public.lark_drafts (
  id uuid primary key default gen_random_uuid(),
  open_id text not null,
  draft jsonb not null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  task_id uuid references public.lark_tasks(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Lark re-delivers an event when it gets no quick answer: each event id is handled once.
create table if not exists public.lark_events (
  event_id text primary key,
  event_type text,
  received_at timestamptz not null default now()
);

create trigger touch_updated_at before update on public.lark_tasks for each row execute function public.touch_updated_at();
create trigger audit_row after insert or update or delete on public.lark_tasks for each row execute function public.audit_row();

revoke all on public.lark_people, public.lark_tasks, public.lark_notifications, public.lark_drafts, public.lark_events from anon, authenticated;
grant select on public.lark_people, public.lark_tasks, public.lark_notifications to authenticated;
grant all on public.lark_people, public.lark_tasks, public.lark_notifications, public.lark_drafts, public.lark_events to service_role;
grant update (lark_mode, lark_api_base, lark_app_id, lark_chat_id, lark_parent_pattern, lark_child_pattern,
              lark_parent_example, lark_child_example, lark_notify_d0, lark_notify_time) on public.settings to authenticated;

alter table public.lark_people enable row level security;
alter table public.lark_tasks enable row level security;
alter table public.lark_notifications enable row level security;
alter table public.lark_drafts enable row level security;
alter table public.lark_events enable row level security;
create policy lark_people_read on public.lark_people for select to authenticated using (public.app_role() is not null);
create policy lark_tasks_read on public.lark_tasks for select to authenticated using (public.app_role() is not null);
create policy lark_notifications_read on public.lark_notifications for select to authenticated using (public.app_role() is not null);

-- Lark App Secret and Verification Token live in Vault; only the Edge Function reads or writes them.
create or replace function public.ops_lark_secrets() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'app_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lark_app_secret' limit 1),
    'verification_token', (select decrypted_secret from vault.decrypted_secrets where name = 'lark_verification_token' limit 1))
$$;
create or replace function public.ops_set_lark_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_name not in ('lark_app_secret','lark_verification_token') then raise exception 'bad_secret_name'; end if;
  select id into v_id from vault.secrets where name = p_name limit 1;
  if v_id is null then perform vault.create_secret(p_value, p_name);
  else perform vault.update_secret(v_id, p_value); end if;
end $$;
revoke all on function public.ops_lark_secrets() from public, anon, authenticated;
revoke all on function public.ops_set_lark_secret(text, text) from public, anon, authenticated;
grant execute on function public.ops_lark_secrets() to service_role;
grant execute on function public.ops_set_lark_secret(text, text) to service_role;
commit;
