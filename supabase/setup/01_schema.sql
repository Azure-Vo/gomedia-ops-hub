-- =====================================================================================
-- Go Media Ops Hub · database setup                                   version 1.0.0
-- Paste the whole file into Supabase → SQL Editor → Run. Safe to run again: it only
-- adds what is missing and refreshes functions, triggers and security policies.
-- Business rules live in src/domain (TypeScript). This file only stores data,
-- protects it (Row Level Security on every table) and applies decisions atomically.
-- =====================================================================================
begin;
set local client_min_messages = warning;

-- ---------------------------------------------------------------- tables (13) -------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'staff' check (role in ('account','pm','ceo','ecom_exec','staff','admin')),
  active boolean not null default true,
  telegram_chat_id bigint unique,
  telegram_link_code text unique,
  telegram_link_expires_at timestamptz,
  tg_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  timezone text not null default 'Asia/Ho_Chi_Minh',
  work_days int[] not null default '{1,2,3,4,5}',
  work_blocks jsonb not null default '[{"start":"08:00","end":"12:00"},{"start":"13:30","end":"17:30"}]',
  holidays date[] not null default '{2026-09-02,2027-01-01}',
  no_reply_window_hours numeric not null default 2 check (no_reply_window_hours > 0),
  quote_late_hours numeric not null default 8 check (quote_late_hours > 0),
  library_review_months int not null default 3 check (library_review_months > 0),
  kpi_baselines jsonb not null default '{"quote_avg_hours":8.66,"quote_late_pct":52.6,"quote_count":19,"task_overdue_pct":55.2}',
  kpi_targets jsonb not null default '{"quote_avg_hours":6.93,"quote_late_pct":30,"response_rate":90,"early_warning":85,"overdue_pct":20}',
  pilot_start date,
  pilot_end date,
  company_name text not null default 'Go Media',
  telegram_bot_username text,
  app_url text,
  system_status jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  unit text not null,
  service_group text not null,
  unit_price bigint not null check (unit_price >= 0),
  band_low bigint check (band_low >= 0),
  band_high bigint check (band_high >= 0),
  last_reviewed_at date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  constraint library_band_order check (band_low is null or band_high is null or band_low <= band_high),
  constraint library_name_unit unique (name, unit)
);

create table if not exists public.price_rules (
  level text primary key check (level in ('send_now','pm','ceo')),
  max_discount_pct numeric check (max_discount_pct between 0 and 100),
  max_deviation_pct numeric check (max_deviation_pct >= 0),
  margin_floor_pct numeric check (margin_floor_pct between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.price_rules (level, max_discount_pct, max_deviation_pct, margin_floor_pct) values
  ('send_now', 10, 10, null), ('pm', 20, 20, null), ('ceo', null, null, null)
on conflict (level) do nothing;

create sequence if not exists public.quote_code_seq;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  client text not null default '',
  service_group text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'draft' check (status in ('draft','pending','approved','changes_requested','sent')),
  discount_pct numeric not null default 0 check (discount_pct between 0 and 100),
  subtotal bigint not null default 0,
  total bigint not null default 0,
  band_result text check (band_result in ('send_now','pm','ceo')),
  band_detail jsonb,
  approver text check (approver in ('pm','ceo')),
  approval_requested_at timestamptz,
  approval_notified_at timestamptz,
  source text not null default 'app' check (source in ('app','import')),
  copied_from uuid references public.quotes(id) on delete set null,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_sent_consistent check ((status = 'sent') = (sent_at is not null)),
  constraint quote_sent_after_request check (sent_at is null or sent_at >= requested_at)
);
create index if not exists quotes_status_idx on public.quotes(status);
create index if not exists quotes_sent_idx on public.quotes(sent_at) where sent_at is not null;

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position int not null default 0,
  library_item_id uuid references public.library_items(id) on delete set null,
  item_name text not null,
  unit text not null default '',
  qty numeric not null check (qty > 0),
  unit_price bigint not null check (unit_price >= 0),
  library_price bigint,
  override_reason text,
  created_at timestamptz not null default now()
);
create index if not exists quote_lines_quote_idx on public.quote_lines(quote_id);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  level text not null check (level in ('pm','ceo')),
  approver_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('approve','changes')),
  comment text,
  decided_at timestamptz not null default now()
);
create index if not exists approvals_quote_idx on public.approvals(quote_id);

create table if not exists public.task_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  milestone_1 text not null,
  milestone_2 text not null,
  milestone_3 text not null,
  milestone_4 text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.task_types (name, milestone_1, milestone_2, milestone_3, milestone_4) values
  ('Booking KOC', 'Brief được duyệt', 'Có danh sách KOC nháp', 'KOC xác nhận tham gia', 'Gửi shortlist cho khách'),
  ('Video sản phẩm', 'Nhận đủ footage', 'Có bản dựng thô', 'Khách góp ý xong', 'Xuất bản cuối'),
  ('Thiết lập SEO', 'Chốt danh sách từ khoá', 'Viết xong meta title/description', 'Đưa lên website', 'QA kiểm tra xong'),
  ('Banner chiến dịch', 'Chốt brief', 'Có bản thiết kế nháp', 'Duyệt nội bộ xong', 'Đăng lên sàn')
on conflict (name) do nothing;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id),
  type_id uuid references public.task_types(id) on delete set null,
  start_at timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'not_started'
    check (status in ('not_started','on_track','at_risk','blocked','no_update','done','overdue','cancelled')),
  closed_as text check (closed_as in ('on_time','overdue')),
  closed_at timestamptz,
  priority_note text,
  cancel_reason text,
  source text not null default 'app' check (source in ('app','import')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_due_after_start check (due_at > start_at)
);
create index if not exists tasks_owner_idx on public.tasks(owner_id);
create index if not exists tasks_open_due_idx on public.tasks(due_at) where closed_as is null;

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  idx int not null check (idx between 1 and 4),
  label text not null,
  done_at timestamptz,
  evidence_url text,
  unique (task_id, idx)
);

create table if not exists public.checkpoints (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  pct int not null check (pct in (25,50,75,99)),
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  sent_via text check (sent_via in ('telegram','web')),
  telegram_message_id bigint,
  answered_at timestamptz,
  answer text check (answer in ('on_plan','behind','blocked')),
  answer_via text check (answer_via in ('telegram','web')),
  answer_reason text,
  token text not null,
  expired_at timestamptz,
  no_reply_alerted_at timestamptz,
  unique (task_id, pct)
);
create index if not exists checkpoints_due_idx on public.checkpoints(scheduled_at) where sent_at is null and expired_at is null;

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  checkpoint_id bigint references public.checkpoints(id) on delete set null,
  kind text not null check (kind in ('at_risk','blocker','no_reply','overdue')),
  reason text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  note text
);
create index if not exists alerts_task_idx on public.alerts(task_id);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  actor uuid default auth.uid(),
  entity text not null,
  entity_id text,
  action text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_entity_idx on public.events(entity, entity_id);
create index if not exists events_created_idx on public.events(created_at);

-- ------------------------------------------------------------- role helpers ---------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = any(roles) from public.profiles p where p.id = auth.uid() and p.active), false)
$$;

-- ---------------------------------------------------------------- triggers ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','settings','library_items','price_rules','quotes','task_types','tasks'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

create or replace function public.stamp_updated_by() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['settings','library_items','price_rules'] loop
    execute format('drop trigger if exists stamp_updated_by on public.%I', t);
    execute format('create trigger stamp_updated_by before insert or update on public.%I for each row execute function public.stamp_updated_by()', t);
  end loop;
end $$;

-- Acknowledging an alert is stamped with the server time.
create or replace function public.alerts_before_update() returns trigger language plpgsql as $$
begin
  if new.acknowledged_by is not null and old.acknowledged_by is null then
    new.acknowledged_at := now();
  elsif new.acknowledged_by is distinct from old.acknowledged_by then
    raise exception 'Cảnh báo đã được xác nhận, không đổi người xác nhận được.';
  else
    new.acknowledged_at := old.acknowledged_at;
  end if;
  return new;
end $$;
drop trigger if exists alerts_before_update on public.alerts;
create trigger alerts_before_update before update on public.alerts for each row execute function public.alerts_before_update();

-- Every new sign-in account gets a profile. Accounts made by the app (Admin invite, demo seed) carry ops_role in app_metadata, which only the
-- server can set. Any other account (a sign-up through the public API, a user added by hand in the
-- dashboard) starts INACTIVE and sees nothing until an admin activates it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := coalesce(new.raw_app_meta_data ->> 'ops_role', 'staff');
  v_active boolean := (new.raw_app_meta_data ? 'ops_role');
begin
  if v_role not in ('account','pm','ceo','ecom_exec','staff','admin') then v_role := 'staff'; end if;
  insert into public.profiles (id, email, full_name, role, active)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), v_role, v_active)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Never lose the last active admin (it would lock everyone out of the Admin page).
create or replace function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'Không thể bỏ quyền admin cuối cùng. Hãy cấp quyền admin cho người khác trước.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists protect_last_admin on public.profiles;
create trigger protect_last_admin before update or delete on public.profiles for each row execute function public.protect_last_admin();

-- Quote codes Q-YYYY-NNN (imported history keeps its own code).
create or replace function public.quotes_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'Q-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY') || '-' || lpad(nextval('public.quote_code_seq')::text, 3, '0');
  end if;
  return new;
end $$;
drop trigger if exists quotes_before_insert on public.quotes;
create trigger quotes_before_insert before insert on public.quotes for each row execute function public.quotes_before_insert();

-- Back to Draft = the previous band result and approver no longer apply.
create or replace function public.quotes_before_update() returns trigger language plpgsql as $$
begin
  if new.status = 'draft' and old.status <> 'draft' then
    new.band_result := null;
    new.band_detail := null;
    new.approver := null;
    new.approval_requested_at := null;
    new.approval_notified_at := null;
  end if;
  return new;
end $$;
drop trigger if exists quotes_before_update on public.quotes;
create trigger quotes_before_update before update on public.quotes for each row execute function public.quotes_before_update();

-- Editing the lines of a quote that came back with "changes requested" puts it in Draft.
create or replace function public.quote_lines_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_quote uuid := coalesce(new.quote_id, old.quote_id);
begin
  update public.quotes set status = 'draft' where id = v_quote and status = 'changes_requested';
  return null;
end $$;
drop trigger if exists quote_lines_after_change on public.quote_lines;
create trigger quote_lines_after_change after insert or update or delete on public.quote_lines
  for each row execute function public.quote_lines_after_change();

-- Audit log: every create, change and delete on these tables, with who and when.
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  n jsonb;
  diff jsonb := '{}';
  k text;
  hidden text[] := array['updated_at','tg_state','telegram_link_code','telegram_link_expires_at','token','system_status'];
begin
  if tg_op = 'INSERT' then
    n := to_jsonb(new) - hidden;
    insert into public.events (actor, entity, entity_id, action, payload) values (auth.uid(), tg_table_name, n ->> 'id', 'insert', n);
    return new;
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old);
    n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      if not (k = any(hidden)) and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if diff <> '{}' then
      insert into public.events (actor, entity, entity_id, action, payload) values (auth.uid(), tg_table_name, n ->> 'id', 'update', diff);
    end if;
    return new;
  else
    o := to_jsonb(old) - hidden;
    insert into public.events (actor, entity, entity_id, action, payload) values (auth.uid(), tg_table_name, o ->> 'id', 'delete', o);
    return old;
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','settings','library_items','price_rules','quotes','quote_lines','task_types','tasks','milestones','alerts'] loop
    execute format('drop trigger if exists audit_row on public.%I', t);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ------------------------------------------------------- privileges (columns) ---------
-- Supabase grants every table to the API roles by default; take that back and grant
-- only what each screen needs. Row Level Security below then decides which rows.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

grant select (id, email, full_name, role, active, created_at, updated_at) on public.profiles to authenticated;
grant update (full_name, role, active) on public.profiles to authenticated;

grant select on public.settings to authenticated;
grant update (timezone, work_days, work_blocks, holidays, no_reply_window_hours, quote_late_hours, library_review_months,
              kpi_baselines, kpi_targets, pilot_start, pilot_end, company_name, telegram_bot_username, app_url)
  on public.settings to authenticated;

grant select on public.library_items to authenticated;
grant insert (code, name, unit, service_group, unit_price, band_low, band_high, last_reviewed_at, active) on public.library_items to authenticated;
grant update (code, name, unit, service_group, unit_price, band_low, band_high, last_reviewed_at, active) on public.library_items to authenticated;

grant select on public.price_rules to authenticated;
grant update (max_discount_pct, max_deviation_pct, margin_floor_pct) on public.price_rules to authenticated;

grant select on public.quotes to authenticated;
grant insert (client, service_group, requested_at, discount_pct, subtotal, total, copied_from) on public.quotes to authenticated;
grant update (client, service_group, requested_at, discount_pct, subtotal, total, status, copied_from) on public.quotes to authenticated;
grant delete on public.quotes to authenticated;

grant select, delete on public.quote_lines to authenticated;
grant insert (quote_id, position, library_item_id, item_name, unit, qty, unit_price, library_price, override_reason) on public.quote_lines to authenticated;
grant update (position, qty, unit_price, library_price, override_reason) on public.quote_lines to authenticated;

grant select on public.approvals to authenticated;

grant select on public.task_types to authenticated;
grant insert (name, milestone_1, milestone_2, milestone_3, milestone_4, active) on public.task_types to authenticated;
grant update (name, milestone_1, milestone_2, milestone_3, milestone_4, active) on public.task_types to authenticated;

grant select on public.tasks to authenticated;
grant update (name, priority_note) on public.tasks to authenticated;

grant select on public.milestones to authenticated;

grant select (id, task_id, pct, scheduled_at, sent_at, sent_via, answered_at, answer, answer_via, answer_reason, expired_at, no_reply_alerted_at)
  on public.checkpoints to authenticated;

grant select on public.alerts to authenticated;
grant update (acknowledged_by, acknowledged_at, note) on public.alerts to authenticated;

grant select on public.events to authenticated;
grant insert (entity, entity_id, action, payload) on public.events to authenticated;

-- The Edge Function works with the service role. The audit log stays append-only for everyone.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke update, delete, truncate on public.events from authenticated, service_role, anon;

-- ----------------------------------------------------- row level security ------------
do $$ declare t text; begin
  foreach t in array array['profiles','settings','library_items','price_rules','quotes','quote_lines','approvals',
                           'task_types','tasks','milestones','checkpoints','alerts','events'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.app_role() is not null);
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = public.app_role() and active);

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (public.app_role() is not null);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy if exists library_read on public.library_items;
create policy library_read on public.library_items for select to authenticated using (public.app_role() is not null);
drop policy if exists library_insert on public.library_items;
create policy library_insert on public.library_items for insert to authenticated with check (public.has_role('pm','ceo','admin'));
drop policy if exists library_update on public.library_items;
create policy library_update on public.library_items for update to authenticated
  using (public.has_role('pm','ceo','admin')) with check (public.has_role('pm','ceo','admin'));

drop policy if exists rules_ceo_read on public.price_rules;
create policy rules_ceo_read on public.price_rules for select to authenticated using (public.has_role('ceo'));
drop policy if exists rules_ceo_update on public.price_rules;
create policy rules_ceo_update on public.price_rules for update to authenticated
  using (public.has_role('ceo')) with check (public.has_role('ceo'));

drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using (
  public.has_role('pm','ceo','admin')
  or (public.has_role('account') and (created_by = auth.uid() or status = 'sent'))
);
drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert to authenticated
  with check (public.has_role('account') and created_by = auth.uid());
drop policy if exists quotes_update on public.quotes;
create policy quotes_update on public.quotes for update to authenticated
  using (public.has_role('account') and created_by = auth.uid() and status in ('draft','changes_requested'))
  with check (created_by = auth.uid() and status = 'draft');
drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes for delete to authenticated
  using (public.has_role('account') and created_by = auth.uid() and status = 'draft' and sent_at is null);

drop policy if exists lines_read on public.quote_lines;
create policy lines_read on public.quote_lines for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id));
drop policy if exists lines_insert on public.quote_lines;
create policy lines_insert on public.quote_lines for insert to authenticated
  with check (exists (select 1 from public.quotes q where q.id = quote_id and q.created_by = auth.uid()
                      and q.status in ('draft','changes_requested') and public.has_role('account')));
drop policy if exists lines_update on public.quote_lines;
create policy lines_update on public.quote_lines for update to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and q.created_by = auth.uid()
                 and q.status in ('draft','changes_requested') and public.has_role('account')))
  with check (exists (select 1 from public.quotes q where q.id = quote_id and q.created_by = auth.uid()));
drop policy if exists lines_delete on public.quote_lines;
create policy lines_delete on public.quote_lines for delete to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and q.created_by = auth.uid()
                 and q.status in ('draft','changes_requested') and public.has_role('account')));

drop policy if exists approvals_read on public.approvals;
create policy approvals_read on public.approvals for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id));

drop policy if exists task_types_read on public.task_types;
create policy task_types_read on public.task_types for select to authenticated using (public.app_role() is not null);
drop policy if exists task_types_write on public.task_types;
create policy task_types_write on public.task_types for insert to authenticated with check (public.has_role('ecom_exec','admin'));
drop policy if exists task_types_update on public.task_types;
create policy task_types_update on public.task_types for update to authenticated
  using (public.has_role('ecom_exec','admin')) with check (public.has_role('ecom_exec','admin'));

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (owner_id = auth.uid() or public.has_role('ecom_exec','ceo','pm','admin'));
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.has_role('ecom_exec','admin')) with check (public.has_role('ecom_exec','admin'));

drop policy if exists milestones_read on public.milestones;
create policy milestones_read on public.milestones for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists checkpoints_read on public.checkpoints;
create policy checkpoints_read on public.checkpoints for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select to authenticated using (public.has_role('ecom_exec','ceo','pm','admin'));
drop policy if exists alerts_ack on public.alerts;
create policy alerts_ack on public.alerts for update to authenticated
  using (public.has_role('ecom_exec','admin')) with check (acknowledged_by = auth.uid());

drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated using (public.has_role('admin','ceo'));
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated with check (actor = auth.uid());

-- ------------------------------------------------------- functions for the web app -----
create or replace function public.my_telegram() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'linked', telegram_chat_id is not null,
    'code', case when telegram_link_expires_at > now() then telegram_link_code end,
    'expires_at', case when telegram_link_expires_at > now() then telegram_link_expires_at end)
  from public.profiles where id = auth.uid()
$$;

create or replace function public.new_telegram_link_code() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  update public.profiles set telegram_link_code = v_code, telegram_link_expires_at = now() + interval '30 minutes'
  where id = auth.uid() and active;
  return jsonb_build_object('code', v_code, 'expires_at', now() + interval '30 minutes');
end $$;

create or replace function public.unlink_telegram() returns void
language sql security definer set search_path = public as $$
  update public.profiles set telegram_chat_id = null, telegram_link_code = null, tg_state = null where id = auth.uid()
$$;

create or replace function public.admin_users() returns table (
  id uuid, email text, full_name text, role text, active boolean, telegram_linked boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('admin') then raise exception 'admin_only'; end if;
  return query select p.id, p.email, p.full_name, p.role, p.active, p.telegram_chat_id is not null, p.created_at
    from public.profiles p order by p.active desc, p.role, p.full_name;
end $$;

-- People an E-commerce Executive can assign tasks to, with whether they can get bot messages.
create or replace function public.task_owners() returns table (id uuid, full_name text, email text, role text, telegram_linked boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('ecom_exec','admin','ceo','pm') then raise exception 'not_allowed'; end if;
  return query select p.id, p.full_name, p.email, p.role, p.telegram_chat_id is not null
    from public.profiles p where p.active order by p.full_name;
end $$;

-- ------------------------------------------- atomic writes for the Edge Function -----
-- These apply decisions already computed by src/domain; they contain no business rule.
create or replace function public.ops_create_task(p jsonb) returns uuid language plpgsql as $$
declare v_id uuid; m jsonb; c jsonb; i int := 0;
begin
  if jsonb_array_length(p -> 'milestones') <> 4 or jsonb_array_length(p -> 'checkpoints') <> 4 then
    raise exception 'need_4_milestones_and_checkpoints';
  end if;
  insert into public.tasks (name, owner_id, type_id, start_at, due_at, priority_note, created_by, source)
  values (p ->> 'name', (p ->> 'owner_id')::uuid, nullif(p ->> 'type_id', '')::uuid, (p ->> 'start_at')::timestamptz,
          (p ->> 'due_at')::timestamptz, nullif(p ->> 'priority_note', ''), nullif(p ->> 'actor', '')::uuid, coalesce(p ->> 'source', 'app'))
  returning id into v_id;
  for m in select * from jsonb_array_elements(p -> 'milestones') loop
    i := i + 1;
    insert into public.milestones (task_id, idx, label) values (v_id, i, m #>> '{}');
  end loop;
  for c in select * from jsonb_array_elements(p -> 'checkpoints') loop
    insert into public.checkpoints (task_id, pct, scheduled_at, token)
    values (v_id, (c ->> 'pct')::int, (c ->> 'scheduled_at')::timestamptz, c ->> 'token');
  end loop;
  insert into public.events (actor, entity, entity_id, action, payload)
  values (nullif(p ->> 'actor', '')::uuid, 'tasks', v_id::text, 'task.created',
          (p - 'checkpoints') || jsonb_build_object('checkpoints',
            (select jsonb_agg(x - 'token') from jsonb_array_elements(p -> 'checkpoints') x)));
  return v_id;
end $$;

create or replace function public.ops_update_task_plan(p jsonb) returns void language plpgsql as $$
declare v_task public.tasks; m jsonb; c jsonb; i int := 0;
begin
  select * into v_task from public.tasks where id = (p ->> 'task_id')::uuid for update;
  if not found then raise exception 'task_not_found'; end if;
  if v_task.closed_as is not null or v_task.status = 'cancelled' then raise exception 'task_closed'; end if;
  if exists (select 1 from public.checkpoints where task_id = v_task.id and sent_at is not null) then
    raise exception 'task_started';
  end if;
  update public.tasks set name = p ->> 'name', owner_id = (p ->> 'owner_id')::uuid, type_id = nullif(p ->> 'type_id', '')::uuid,
    start_at = (p ->> 'start_at')::timestamptz, due_at = (p ->> 'due_at')::timestamptz, priority_note = nullif(p ->> 'priority_note', '')
  where id = v_task.id;
  for m in select * from jsonb_array_elements(p -> 'milestones') loop
    i := i + 1;
    update public.milestones set label = m #>> '{}' where task_id = v_task.id and idx = i;
  end loop;
  for c in select * from jsonb_array_elements(p -> 'checkpoints') loop
    update public.checkpoints set scheduled_at = (c ->> 'scheduled_at')::timestamptz, expired_at = null
    where task_id = v_task.id and pct = (c ->> 'pct')::int;
  end loop;
  insert into public.events (actor, entity, entity_id, action, payload)
  values (nullif(p ->> 'actor', '')::uuid, 'tasks', v_task.id::text, 'task.plan_updated', p - 'checkpoints');
end $$;

create or replace function public.ops_cancel_task(p jsonb) returns void language plpgsql as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = (p ->> 'task_id')::uuid for update;
  if not found then raise exception 'task_not_found'; end if;
  if v_task.closed_as is not null or v_task.status = 'cancelled' then raise exception 'task_closed'; end if;
  update public.tasks set status = 'cancelled', cancel_reason = p ->> 'reason' where id = v_task.id;
  update public.checkpoints set expired_at = now() where task_id = v_task.id and answered_at is null and expired_at is null;
  insert into public.events (actor, entity, entity_id, action, payload)
  values (nullif(p ->> 'actor', '')::uuid, 'tasks', v_task.id::text, 'task.cancelled', jsonb_build_object('reason', p ->> 'reason'));
end $$;

create or replace function public.ops_apply_answer(p jsonb) returns jsonb language plpgsql as $$
declare
  v_task public.tasks;
  v_cp public.checkpoints;
  v_done int;
  v_alert uuid;
  v_effect jsonb := p -> 'effect';
  v_cp_id bigint := nullif(p ->> 'checkpoint_id', '')::bigint;
begin
  select * into v_task from public.tasks where id = (p ->> 'task_id')::uuid for update;
  if not found then raise exception 'task_not_found'; end if;
  if v_task.closed_as is not null or v_task.status in ('cancelled','overdue') then raise exception 'task_closed'; end if;
  select count(*) into v_done from public.milestones where task_id = v_task.id and done_at is not null;
  if v_done <> (p ->> 'expected_done')::int or v_task.status <> p ->> 'expected_status' then raise exception 'conflict'; end if;
  if v_cp_id is not null then
    select * into v_cp from public.checkpoints where id = v_cp_id and task_id = v_task.id for update;
    if not found then raise exception 'checkpoint_not_found'; end if;
    if v_cp.answered_at is not null then raise exception 'already_answered'; end if;
    if v_cp.expired_at is not null then raise exception 'checkpoint_expired'; end if;
    if v_cp.sent_at is null then raise exception 'checkpoint_not_sent'; end if;
    update public.checkpoints set answered_at = now(), answer = p ->> 'answer', answer_via = p ->> 'via',
      answer_reason = nullif(p ->> 'reason', '') where id = v_cp_id;
  end if;
  update public.milestones set done_at = now()
  where task_id = v_task.id and done_at is null
    and idx in (select (x #>> '{}')::int from jsonb_array_elements(coalesce(v_effect -> 'markDone', '[]')) x);
  if coalesce(p ->> 'evidence_url', '') <> '' and nullif(p ->> 'milestone_idx', '') is not null then
    update public.milestones set evidence_url = p ->> 'evidence_url'
    where task_id = v_task.id and idx = (p ->> 'milestone_idx')::int;
  end if;
  update public.tasks set status = v_effect ->> 'status' where id = v_task.id;
  if jsonb_typeof(v_effect -> 'alert') = 'object' then
    insert into public.alerts (task_id, checkpoint_id, kind, reason)
    values (v_task.id, v_cp_id, v_effect -> 'alert' ->> 'kind', v_effect -> 'alert' ->> 'reason')
    returning id into v_alert;
  end if;
  insert into public.events (actor, entity, entity_id, action, payload)
  values (nullif(p ->> 'actor', '')::uuid, 'tasks', v_task.id::text,
          case when v_cp_id is null then 'task.blocker_reported' else 'checkpoint.answered' end,
          jsonb_build_object('checkpoint_id', v_cp_id, 'answer', p ->> 'answer', 'via', p ->> 'via', 'reason', p ->> 'reason',
                             'evidence_url', p ->> 'evidence_url', 'status', v_effect ->> 'status', 'alert_id', v_alert));
  return jsonb_build_object('task_id', v_task.id, 'status', v_effect ->> 'status', 'alert_id', v_alert);
end $$;

create or replace function public.ops_no_reply(p jsonb) returns uuid language plpgsql as $$
declare v_cp public.checkpoints; v_task public.tasks; v_alert uuid;
begin
  select * into v_cp from public.checkpoints where id = (p ->> 'checkpoint_id')::bigint for update;
  if not found or v_cp.answered_at is not null or v_cp.no_reply_alerted_at is not null or v_cp.sent_at is null then return null; end if;
  select * into v_task from public.tasks where id = v_cp.task_id for update;
  if v_task.closed_as is not null or v_task.status = 'cancelled' then return null; end if;
  update public.checkpoints set no_reply_alerted_at = now() where id = v_cp.id;
  update public.tasks set status = p ->> 'new_status' where id = v_task.id and status <> (p ->> 'new_status');
  insert into public.alerts (task_id, checkpoint_id, kind, reason)
  values (v_task.id, v_cp.id, 'no_reply', p ->> 'reason') returning id into v_alert;
  insert into public.events (actor, entity, entity_id, action, payload)
  values (null, 'tasks', v_task.id::text, 'checkpoint.no_reply', jsonb_build_object('checkpoint_id', v_cp.id, 'alert_id', v_alert));
  return v_alert;
end $$;

create or replace function public.ops_close_task(p jsonb) returns jsonb language plpgsql as $$
declare v_task public.tasks; v_alert uuid;
begin
  select * into v_task from public.tasks where id = (p ->> 'task_id')::uuid for update;
  if not found or v_task.closed_as is not null or v_task.status = 'cancelled' then return null; end if;
  update public.tasks set closed_as = p ->> 'closed_as', closed_at = now(), status = p ->> 'status' where id = v_task.id;
  update public.checkpoints set expired_at = now() where task_id = v_task.id and answered_at is null and expired_at is null;
  if p ->> 'closed_as' = 'overdue' then
    insert into public.alerts (task_id, kind, reason) values (v_task.id, 'overdue', p ->> 'reason') returning id into v_alert;
  end if;
  insert into public.events (actor, entity, entity_id, action, payload)
  values (null, 'tasks', v_task.id::text, 'task.closed', jsonb_build_object('closed_as', p ->> 'closed_as', 'alert_id', v_alert));
  return jsonb_build_object('alert_id', v_alert);
end $$;

drop function if exists public.ops_quote_transition(jsonb);
create or replace function public.ops_quote_transition(p jsonb) returns jsonb language plpgsql as $$
declare v_q public.quotes; f jsonb := coalesce(p -> 'fields', '{}');
begin
  select * into v_q from public.quotes where id = (p ->> 'quote_id')::uuid for update;
  if not found then raise exception 'quote_not_found'; end if;
  if v_q.status <> p ->> 'expected_status' then raise exception 'conflict'; end if;
  update public.quotes set
    status = p ->> 'new_status',
    band_result = case when f ? 'band_result' then f ->> 'band_result' else band_result end,
    band_detail = case when f ? 'band_detail' then f -> 'band_detail' else band_detail end,
    approver = case when f ? 'approver' then f ->> 'approver' else approver end,
    approval_requested_at = case when f ? 'approval_requested' then now() else approval_requested_at end,
    approval_notified_at = case when f ? 'approval_notified' then now() else approval_notified_at end,
    subtotal = case when f ? 'subtotal' then (f ->> 'subtotal')::bigint else subtotal end,
    total = case when f ? 'total' then (f ->> 'total')::bigint else total end,
    sent_at = case when p ->> 'new_status' = 'sent' then now() else sent_at end
  where id = v_q.id
  returning * into v_q;
  if jsonb_typeof(p -> 'approval') = 'object' then
    insert into public.approvals (quote_id, level, approver_id, decision, comment)
    values (v_q.id, p -> 'approval' ->> 'level', (p -> 'approval' ->> 'approver_id')::uuid,
            p -> 'approval' ->> 'decision', nullif(p -> 'approval' ->> 'comment', ''));
  end if;
  insert into public.events (actor, entity, entity_id, action, payload)
  values (nullif(p ->> 'actor', '')::uuid, 'quotes', v_q.id::text, p ->> 'event_action',
          coalesce(p -> 'event_payload', '{}') || jsonb_build_object('from', p ->> 'expected_status', 'to', p ->> 'new_status'));
  return to_jsonb(v_q);
end $$;

create or replace function public.ops_import_quotes(p jsonb) returns jsonb language plpgsql as $$
declare q jsonb; l jsonb; v_id uuid; n_in int := 0; skipped text[] := '{}'; pos int;
begin
  for q in select * from jsonb_array_elements(p -> 'quotes') loop
    if exists (select 1 from public.quotes where code = q ->> 'code') then
      skipped := skipped || (q ->> 'code');
      continue;
    end if;
    insert into public.quotes (code, client, service_group, requested_at, sent_at, status, discount_pct, subtotal, total, source, created_by)
    values (q ->> 'code', coalesce(q ->> 'client', ''), nullif(q ->> 'service_group', ''), (q ->> 'requested_at')::timestamptz,
            (q ->> 'sent_at')::timestamptz, 'sent', coalesce((q ->> 'discount_pct')::numeric, 0), (q ->> 'subtotal')::bigint,
            (q ->> 'total')::bigint, 'import', (p ->> 'actor')::uuid)
    returning id into v_id;
    pos := 0;
    for l in select * from jsonb_array_elements(q -> 'lines') loop
      pos := pos + 1;
      insert into public.quote_lines (quote_id, position, library_item_id, item_name, unit, qty, unit_price, library_price)
      values (v_id, pos, nullif(l ->> 'library_item_id', '')::uuid, l ->> 'item_name', coalesce(l ->> 'unit', ''),
              (l ->> 'qty')::numeric, (l ->> 'unit_price')::bigint, nullif(l ->> 'library_price', '')::bigint);
    end loop;
    n_in := n_in + 1;
  end loop;
  insert into public.events (actor, entity, entity_id, action, payload)
  values ((p ->> 'actor')::uuid, 'quotes', null, 'quotes.imported', jsonb_build_object('inserted', n_in, 'skipped', skipped));
  return jsonb_build_object('inserted', n_in, 'skipped', skipped);
end $$;

-- Cron calls carry a secret kept in Vault; the Edge Function reads it through this.
create or replace function public.ops_cron_secret() returns text
language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ops_cron_secret' limit 1
$$;

-- Functions are callable by everyone by default in Postgres: restrict them.
do $$ declare f text; begin
  foreach f in array array[
    'ops_create_task(jsonb)','ops_update_task_plan(jsonb)','ops_cancel_task(jsonb)','ops_apply_answer(jsonb)',
    'ops_no_reply(jsonb)','ops_close_task(jsonb)','ops_quote_transition(jsonb)','ops_import_quotes(jsonb)','ops_cron_secret()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['my_telegram()','new_telegram_link_code()','unlink_telegram()','admin_users()','task_owners()',
                           'app_role()','has_role(text[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['touch_updated_at()','handle_new_user()','protect_last_admin()','quotes_before_insert()',
                           'quotes_before_update()','quote_lines_after_change()','audit_row()','stamp_updated_by()',
                           'alerts_before_update()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
