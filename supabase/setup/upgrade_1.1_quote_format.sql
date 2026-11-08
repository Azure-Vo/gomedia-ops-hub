-- =====================================================================================
-- Go Media Ops Hub · upgrade 1.0 → 1.1 (Go Media quote format)
-- For a project already set up with 01_schema.sql 1.0. Adds columns and one table, refreshes three
-- functions, grants and policies. No drops, no data loss: quotes made before 1.1 keep their totals
-- (VAT 0). Running 01_schema.sql 1.1 in full does the same; this file is the minimal version.
-- =====================================================================================
begin;

-- 1.1 · Go Media quote format: VAT shown separately, client block, sections, scope text per line,
-- terms checklist, and pass-through money (e.g. an ads budget paid for the client: no discount,
-- no price band, no VAT unless the setting says so). Columns are added in place so this file still
-- upgrades an existing project safely.
alter table public.settings
  add column if not exists vat_pct numeric not null default 8 check (vat_pct between 0 and 100),
  add column if not exists vat_on_pass_through boolean not null default false,
  add column if not exists company_legal_name text not null default '',
  add column if not exists company_tax_code text not null default '',
  add column if not exists company_address text not null default '',
  add column if not exists company_phone text not null default '',
  add column if not exists company_website text not null default '',
  add column if not exists signer_name text not null default '',
  add column if not exists signer_title text not null default '';
alter table public.library_items
  add column if not exists description text,
  add column if not exists kind text not null default 'service' check (kind in ('service','pass_through'));
alter table public.quotes
  add column if not exists contact text not null default '',
  add column if not exists project text not null default '',
  add column if not exists venue text not null default '',
  add column if not exists vat_pct numeric check (vat_pct between 0 and 100),
  add column if not exists vat_amount bigint not null default 0,
  add column if not exists grand_total bigint not null default 0,
  add column if not exists terms jsonb;
alter table public.quote_lines
  add column if not exists section text not null default '',
  add column if not exists description text,
  add column if not exists kind text not null default 'service' check (kind in ('service','pass_through'));
-- Quotes made before 1.1 had no VAT: keep their totals exactly as they were.
update public.quotes set vat_pct = 0, grand_total = total, terms = '[]' where vat_pct is null;

create table if not exists public.quote_terms (
  id uuid primary key default gen_random_uuid(),
  text text not null check (length(trim(text)) > 0),
  default_on boolean not null default false,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid()
);
-- Starting terms, taken from the CEO's sample quotes (Go Quote AI). The PM edits them on the Price library page.
insert into public.quote_terms (text, default_on, position)
select t.text, t.default_on, t.position from (values
  ('Đơn giá chưa gồm thuế GTGT; thuế GTGT được tách riêng ở phần tổng cộng.', true, 1),
  ('Thanh toán 60% tạm ứng trước ngày thực hiện, 40% khi bàn giao sản phẩm.', true, 2),
  ('Thanh toán 50% khi ký hợp đồng, 30% sau buổi quay cuối, 20% sau nghiệm thu.', false, 3),
  ('Thanh toán theo tháng; đối soát chi tiêu quảng cáo trong 5 ngày đầu tháng sau.', false, 4),
  ('Từ vòng chỉnh sửa thứ 3 tính phí 1.500.000 đ/vòng.', false, 5),
  ('Khách hàng cung cấp mặt bằng, nhân sự tham gia và bộ nhận diện thương hiệu.', false, 6),
  ('Chưa bao gồm chi phí booking KOL/KOC và diễn viên nổi tiếng.', false, 7),
  ('Ngân sách quảng cáo chi theo thực tế; tài khoản quảng cáo thuộc quyền sở hữu của khách.', false, 8),
  ('Báo giá có hiệu lực trong 15 ngày kể từ ngày phát hành.', true, 9),
  ('Khách được sử dụng không giới hạn sản phẩm sau khi thanh toán đủ.', true, 10)
) as t(text, default_on, position)
where not exists (select 1 from public.quote_terms);

-- Quote codes Q-YYYY-NNN (imported history keeps its own code). A new quote takes today's VAT rate
-- and the terms the PM marked as default, so later setting changes never alter it.
create or replace function public.quotes_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'Q-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY') || '-' || lpad(nextval('public.quote_code_seq')::text, 3, '0');
  end if;
  if new.vat_pct is null then
    new.vat_pct := coalesce((select vat_pct from public.settings where id = 1), 0);
  end if;
  if new.terms is null then
    new.terms := coalesce((select jsonb_agg(t.text order by t.position, t.created_at) from public.quote_terms t where t.active and t.default_on), '[]');
  end if;
  return new;
end $$;

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

create or replace function public.ops_import_quotes(p jsonb) returns jsonb language plpgsql set search_path = public as $$
declare q jsonb; l jsonb; v_id uuid; n_in int := 0; skipped text[] := '{}'; pos int;
begin
  for q in select * from jsonb_array_elements(p -> 'quotes') loop
    if exists (select 1 from public.quotes where code = q ->> 'code') then
      skipped := skipped || (q ->> 'code');
      continue;
    end if;
    -- History files carry no VAT: the imported total is what was quoted.
    insert into public.quotes (code, client, service_group, requested_at, sent_at, status, discount_pct, subtotal, total,
                               vat_pct, vat_amount, grand_total, terms, source, created_by)
    values (q ->> 'code', coalesce(q ->> 'client', ''), nullif(q ->> 'service_group', ''), (q ->> 'requested_at')::timestamptz,
            (q ->> 'sent_at')::timestamptz, 'sent', coalesce((q ->> 'discount_pct')::numeric, 0), (q ->> 'subtotal')::bigint,
            (q ->> 'total')::bigint, 0, 0, (q ->> 'total')::bigint, '[]', 'import', (p ->> 'actor')::uuid)
    returning id into v_id;
    pos := 0;
    for l in select * from jsonb_array_elements(q -> 'lines') loop
      pos := pos + 1;
      insert into public.quote_lines (quote_id, position, library_item_id, item_name, unit, qty, unit_price, library_price, kind)
      values (v_id, pos, nullif(l ->> 'library_item_id', '')::uuid, l ->> 'item_name', coalesce(l ->> 'unit', ''),
              (l ->> 'qty')::numeric, (l ->> 'unit_price')::bigint, nullif(l ->> 'library_price', '')::bigint,
              case when l ->> 'kind' = 'pass_through' then 'pass_through' else 'service' end);
    end loop;
    n_in := n_in + 1;
  end loop;
  insert into public.events (actor, entity, entity_id, action, payload)
  values ((p ->> 'actor')::uuid, 'quotes', null, 'quotes.imported', jsonb_build_object('inserted', n_in, 'skipped', skipped));
  return jsonb_build_object('inserted', n_in, 'skipped', skipped);
end $$;

-- quote_terms: timestamps, audit, privileges, Row Level Security
create trigger touch_updated_at before update on public.quote_terms for each row execute function public.touch_updated_at();
create trigger stamp_updated_by before insert or update on public.quote_terms for each row execute function public.stamp_updated_by();
create trigger audit_row after insert or update or delete on public.quote_terms for each row execute function public.audit_row();

revoke all on public.quote_terms from anon, authenticated;
grant select on public.quote_terms to authenticated;
grant insert (text, default_on, position, active) on public.quote_terms to authenticated;
grant update (text, default_on, position, active) on public.quote_terms to authenticated;
grant all on public.quote_terms to service_role;

grant update (vat_pct, vat_on_pass_through, company_legal_name, company_tax_code, company_address, company_phone,
              company_website, signer_name, signer_title) on public.settings to authenticated;
grant insert (description, kind), update (description, kind) on public.library_items to authenticated;
grant insert (contact, project, venue, vat_pct, vat_amount, grand_total, terms),
      update (contact, project, venue, vat_pct, vat_amount, grand_total, terms) on public.quotes to authenticated;
grant insert (section, description, kind) on public.quote_lines to authenticated;
grant update (section, description) on public.quote_lines to authenticated;

alter table public.quote_terms enable row level security;
create policy terms_read on public.quote_terms for select to authenticated using (public.app_role() is not null);
create policy terms_insert on public.quote_terms for insert to authenticated with check (public.has_role('pm','ceo','admin'));
create policy terms_update on public.quote_terms for update to authenticated
  using (public.has_role('pm','ceo','admin')) with check (public.has_role('pm','ceo','admin'));

commit;
