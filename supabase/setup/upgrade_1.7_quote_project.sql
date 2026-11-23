-- =====================================================================================
-- Go Media Ops Hub · upgrade 1.6.x → 1.7.0 (23/11/2026, Long)
-- Quote → Project: quote kind (quick / project), the CEO signing step ("Chờ CEO ký") with its
-- own timestamp, the client's answer (won / lost with a reason, PM who takes it over), the link
-- between projects and quotes (one project, many quotes; one quote, one project), and the link
-- from a task to the quote line it delivers (used from 1.7.1). The Account of a linked quote
-- sees the project read-only. Additive and safe to run more than once.
-- =====================================================================================
begin;

alter table public.quotes
  add column if not exists kind text not null default 'quick',
  add column if not exists signed_at timestamptz,
  add column if not exists signed_by uuid references public.profiles(id) on delete set null,
  add column if not exists outcome text,
  add column if not exists outcome_at timestamptz,
  add column if not exists outcome_by uuid references public.profiles(id) on delete set null,
  add column if not exists lost_reason text,
  add column if not exists lost_note text,
  add column if not exists handover_pm uuid references public.profiles(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_kind_ck') then
    alter table public.quotes add constraint quotes_kind_ck check (kind in ('quick','project'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_outcome_ck') then
    alter table public.quotes add constraint quotes_outcome_ck check (outcome is null or outcome in ('won','lost'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_lost_reason_ck') then
    alter table public.quotes add constraint quotes_lost_reason_ck check (lost_reason is null or lost_reason in ('price','competitor','postponed','other'));
  end if;
  -- New status "signing" (Chờ CEO ký) between approval and sending.
  alter table public.quotes drop constraint if exists quotes_status_check;
  alter table public.quotes add constraint quotes_status_check check (status in ('draft','pending','signing','approved','changes_requested','sent'));
end $$;
create index if not exists quotes_won_idx on public.quotes (handover_pm) where outcome = 'won';

-- Back to Draft also clears the signature.
create or replace function public.quotes_before_update() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'draft' and old.status <> 'draft' then
    new.band_result := null;
    new.band_detail := null;
    new.approver := null;
    new.approval_requested_at := null;
    new.approval_notified_at := null;
    new.signed_at := null;
    new.signed_by := null;
  end if;
  -- The client's answer only exists on a sent quote (it is set by the Edge Function).
  if new.status <> 'sent' then
    new.outcome := null; new.outcome_at := null; new.outcome_by := null;
    new.lost_reason := null; new.lost_note := null; new.handover_pm := null;
  end if;
  return new;
end $$;

-- The transition function learns the signature fields.
create or replace function public.ops_quote_transition(p jsonb) returns jsonb language plpgsql set search_path = public as $$
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
    vat_amount = case when f ? 'vat_amount' then (f ->> 'vat_amount')::bigint else vat_amount end,
    grand_total = case when f ? 'grand_total' then (f ->> 'grand_total')::bigint else grand_total end,
    signed_at = case when f ? 'signed_by' then now() else signed_at end,
    signed_by = case when f ? 'signed_by' then (f ->> 'signed_by')::uuid else signed_by end,
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
revoke all on function public.ops_quote_transition(jsonb) from public, anon, authenticated;

-- One project, many quotes; a quote belongs to one project.
create table if not exists public.project_quotes (
  project_id uuid not null references public.lark_tasks(id) on delete cascade,
  quote_id uuid not null unique references public.quotes(id) on delete cascade,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (project_id, quote_id)
);
alter table public.project_quotes enable row level security;

-- A task delivers (part of) one quote line; null = outside the quote.
alter table public.lark_tasks add column if not exists quote_line_id uuid references public.quote_lines(id) on delete set null;

-- The Account of a linked quote sees the project, read-only (all writes go through the Edge Function).
create or replace function public.ops_project_visible(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('pm','ceo','admin')
      or exists (select 1 from public.project_members m where m.project_id = p and m.profile_id = auth.uid() and m.status = 'accepted')
      or exists (select 1 from public.lark_tasks c where c.parent_id = p and c.kind = 'child' and c.assignee_id = auth.uid())
      or exists (select 1 from public.project_quotes pq join public.quotes q on q.id = pq.quote_id where pq.project_id = p and q.created_by = auth.uid())
$$;

drop policy if exists project_quotes_read on public.project_quotes;
create policy project_quotes_read on public.project_quotes for select to authenticated
  using (public.has_role('pm','ceo','admin') or exists (select 1 from public.quotes q where q.id = quote_id and q.created_by = auth.uid()));
grant select on public.project_quotes to authenticated;

drop trigger if exists audit_row on public.project_quotes;
create trigger audit_row after insert or update or delete on public.project_quotes for each row execute function public.audit_row();

-- 1.7.0 fix (23/11): the Account sets the quote kind directly from the builder (column grant was missing),
-- and terms in the same choice group exclude each other (one payment schedule per quote).
grant insert (kind) on public.quotes to authenticated;
grant update (kind) on public.quotes to authenticated;
alter table public.quote_terms add column if not exists choice_group text;
grant insert (choice_group) on public.quote_terms to authenticated;
grant update (choice_group) on public.quote_terms to authenticated;
update public.quote_terms set choice_group = 'Hình thức thanh toán' where choice_group is null and text ilike 'Thanh toán%';
-- One default per group: keep the first one.
update public.quote_terms t set default_on = false
  where t.choice_group is not null and t.default_on
    and exists (select 1 from public.quote_terms o where o.choice_group = t.choice_group and o.default_on and (o.position, o.id::text) < (t.position, t.id::text));

commit;
