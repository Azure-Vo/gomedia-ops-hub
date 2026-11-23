-- =====================================================================================
-- Go Media Ops Hub · upgrade 1.6 → 1.6.1 (23/11/2026, Long)
-- Project invitations: the PM invites a person, the person accepts or declines (with a reason
-- that goes back to the PM). A project is only visible to members who accepted. Members that
-- already exist (and members synced from the Lark group) count as accepted.
-- Additive and safe to run more than once. Running 01_schema.sql 1.6.1 in full does the same.
-- =====================================================================================
begin;

alter table public.project_members
  add column if not exists status text not null default 'accepted',
  add column if not exists invited_by uuid references public.profiles(id) on delete set null,
  add column if not exists invited_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists decline_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_members_status_ck') then
    alter table public.project_members add constraint project_members_status_ck check (status in ('invited','accepted','declined'));
  end if;
end $$;
create index if not exists project_members_pending_idx on public.project_members (profile_id) where status = 'invited';

-- Only accepted members (or people with a task in it) see a project.
create or replace function public.ops_project_visible(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('pm','ceo','admin')
      or exists (select 1 from public.project_members m where m.project_id = p and m.profile_id = auth.uid() and m.status = 'accepted')
      or exists (select 1 from public.lark_tasks c where c.parent_id = p and c.kind = 'child' and c.assignee_id = auth.uid())
$$;

-- A person always sees their own invitation rows.
drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members for select to authenticated
  using (public.ops_project_visible(project_id) or profile_id = auth.uid());

-- What an invited person may see about the project before accepting: name, client, dates, PM.
create or replace view public.my_project_invitations as
  select m.id, m.project_id, m.status, m.invited_at, m.responded_at, m.decline_reason,
         p.code, p.name, p.client, p.start_date, p.due_date, p.assignee_name as pm_name, p.color
  from public.project_members m
  join public.lark_tasks p on p.id = m.project_id
  where m.profile_id = auth.uid() and p.kind = 'parent' and p.deleted_at is null and p.state = 'active';
revoke all on public.my_project_invitations from anon, public;
grant select on public.my_project_invitations to authenticated, service_role;

commit;
