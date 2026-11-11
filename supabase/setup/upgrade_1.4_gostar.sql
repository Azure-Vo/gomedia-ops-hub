-- =====================================================================================
-- Go Media Ops Hub · upgrade 1.3 → 1.4 (Go Star). Adds two tables only; no drops, no change to
-- existing data. Running 01_schema.sql 1.4 in full does the same.
-- =====================================================================================
begin;

-- ============================================================================================
-- 1.4 · Go Star: monthly staff recognition next to S1. Task Completion and Deadline are counted
-- from the Lark sub-tasks; the manager (PM, E-com Exec, CEO) enters Work Quality and Teamwork
-- (1–5) and the individual KPI % each month. The CEO closes the month: the ranking is frozen in
-- gostar_months and that month's scores can no longer change. Rules: src/domain/gostar.ts.
-- ============================================================================================
create table if not exists public.gostar_months (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  result jsonb not null,
  finalized_by uuid not null default auth.uid() references public.profiles(id) on delete set null,
  finalized_at timestamptz not null default now()
);
create table if not exists public.gostar_scores (
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  open_id text not null references public.lark_people(open_id) on delete cascade,
  kpi_name text not null default '',
  kpi_pct numeric(5,1) check (kpi_pct between 0 and 300),
  quality smallint check (quality between 1 and 5),
  teamwork smallint check (teamwork between 1 and 5),
  note text not null default '',
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (month, open_id)
);
drop trigger if exists touch_updated_at on public.gostar_scores;
create trigger touch_updated_at before update on public.gostar_scores for each row execute function public.touch_updated_at();

revoke all on public.gostar_months, public.gostar_scores from anon, authenticated;
grant select, insert, delete on public.gostar_months to authenticated;
grant select, insert, update on public.gostar_scores to authenticated;
grant all on public.gostar_months, public.gostar_scores to service_role;

alter table public.gostar_months enable row level security;
alter table public.gostar_scores enable row level security;
drop policy if exists gostar_months_read on public.gostar_months;
create policy gostar_months_read on public.gostar_months for select to authenticated using (public.app_role() is not null);
drop policy if exists gostar_months_close on public.gostar_months;
create policy gostar_months_close on public.gostar_months for insert to authenticated
  with check (public.has_role('ceo') and finalized_by = auth.uid());
drop policy if exists gostar_months_reopen on public.gostar_months;
create policy gostar_months_reopen on public.gostar_months for delete to authenticated using (public.has_role('ceo'));
drop policy if exists gostar_scores_read on public.gostar_scores;
create policy gostar_scores_read on public.gostar_scores for select to authenticated using (public.app_role() is not null);
drop policy if exists gostar_scores_insert on public.gostar_scores;
create policy gostar_scores_insert on public.gostar_scores for insert to authenticated
  with check (public.has_role('pm','ecom_exec','ceo') and updated_by = auth.uid()
              and not exists (select 1 from public.gostar_months m where m.month = gostar_scores.month));
drop policy if exists gostar_scores_update on public.gostar_scores;
create policy gostar_scores_update on public.gostar_scores for update to authenticated
  using (public.has_role('pm','ecom_exec','ceo') and not exists (select 1 from public.gostar_months m where m.month = gostar_scores.month))
  with check (public.has_role('pm','ecom_exec','ceo') and updated_by = auth.uid()
              and not exists (select 1 from public.gostar_months m where m.month = gostar_scores.month));
commit;
