-- =====================================================================================
-- Go Media Ops Hub · upgrade 1.7.0 → 1.8.0 (28/11/2026, Long · sau buổi consult CEO 27/11)
-- 1. Hành trình báo giá: thang Tốt / Trung bình / Yếu / Kém (ngưỡng CEO chỉnh) và hàm đọc các mốc
--    của báo giá cho Dashboard (PM / CEO / Admin).
-- 2. Ba chữ ký: Account ký khi gửi duyệt / gửi khách, CEO ký (đã có), khách ký qua link công khai.
-- 3. Tin bot báo giá vào Lark: gắn tin với báo giá; webhook nhóm Lark (Custom Bot) lưu ở bảng
--    không ai đọc được ngoài Edge Function.
-- Chỉ thêm mới, chạy lại nhiều lần được.
-- =====================================================================================
begin;

-- ------------------------------------------------------------------------- 1. thang đánh giá --------
alter table public.settings
  add column if not exists quote_grade_fair_hours numeric not null default 16,
  add column if not exists quote_grade_weak_hours numeric not null default 24;
grant update (quote_grade_fair_hours, quote_grade_weak_hours) on public.settings to authenticated;

-- ---------------------------------------------------------------------------- 2. chữ ký --------
alter table public.quotes
  add column if not exists account_signed_at timestamptz,
  add column if not exists account_signed_by uuid references public.profiles(id) on delete set null,
  add column if not exists client_token text,
  add column if not exists client_viewed_at timestamptz,
  add column if not exists client_signed_at timestamptz,
  add column if not exists client_signer_name text,
  add column if not exists client_signer_title text,
  add column if not exists client_signature text,
  add column if not exists client_note text;
create unique index if not exists quotes_client_token_idx on public.quotes (client_token) where client_token is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_client_signature_ck') then
    alter table public.quotes add constraint quotes_client_signature_ck check (client_signature is null or (client_signature like 'data:image/png;base64,%' and length(client_signature) <= 400000));
  end if;
end $$;

-- Mỗi người một ảnh chữ ký (Account, PM, CEO), vẽ ở trang Hồ sơ. Ghi qua Edge Function.
create table if not exists public.user_signatures (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  image text not null check (image like 'data:image/png;base64,%' and length(image) <= 400000),
  updated_at timestamptz not null default now()
);
alter table public.user_signatures enable row level security;
drop policy if exists user_signatures_read on public.user_signatures;
create policy user_signatures_read on public.user_signatures for select to authenticated
  using (public.has_role('account','pm','ceo','admin'));
revoke all on public.user_signatures from anon, authenticated;
grant select on public.user_signatures to authenticated;
grant all on public.user_signatures to service_role;

-- Về Nháp thì bỏ chữ ký Account (ký lại khi gửi duyệt). Chữ ký khách chỉ có trên báo giá đã gửi.
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
    new.account_signed_at := null;
    new.account_signed_by := null;
  end if;
  if new.status <> 'sent' then
    new.outcome := null; new.outcome_at := null; new.outcome_by := null;
    new.lost_reason := null; new.lost_note := null; new.handover_pm := null;
    new.client_token := null; new.client_viewed_at := null; new.client_signed_at := null;
    new.client_signer_name := null; new.client_signer_title := null; new.client_signature := null; new.client_note := null;
  end if;
  return new;
end $$;

-- --------------------------------------------------------------------- 3. tin bot báo giá --------
alter table public.bot_messages add column if not exists quote_id uuid references public.quotes(id) on delete cascade;
create index if not exists bot_messages_quote_idx on public.bot_messages (quote_id, created_at desc) where quote_id is not null;
drop policy if exists bot_messages_read on public.bot_messages;
create policy bot_messages_read on public.bot_messages for select to authenticated using (
  public.app_role() in ('pm','ceo','admin')
  or (channel = 'group' and project_id is not null and public.ops_project_visible(project_id))
  or to_open_id in (select open_id from public.lark_people where profile_id = auth.uid())
  or (quote_id is not null and exists (select 1 from public.quotes q where q.id = quote_id and q.created_by = auth.uid())));

-- Webhook Custom Bot của nhóm Lark. URL là bí mật (ai có URL đều gửi được tin vào nhóm).
create table if not exists public.lark_webhook (
  id int primary key default 1 check (id = 1),
  url text not null check (url ~ '^https://open\.(larksuite\.com|feishu\.cn)/open-apis/bot/v2/hook/[A-Za-z0-9-]+$'),
  secret text,
  label text not null default '',
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.lark_webhook enable row level security;
revoke all on public.lark_webhook from anon, authenticated;
grant all on public.lark_webhook to service_role;

-- --------------------------------------------------------------- 4. dữ liệu hành trình --------
-- Báo giá (nhập trong app) có mốc nhận yêu cầu hoặc gửi khách trong kỳ, kèm các mốc trạng thái.
create or replace function public.ops_quote_journey(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('pm','ceo','admin') then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'code', q.code, 'client', q.client, 'kind', q.kind, 'status', q.status,
      'account_id', q.created_by, 'account_name', coalesce(nullif(p.full_name, ''), p.email),
      'requested_at', q.requested_at, 'sent_at', q.sent_at, 'client_signed_at', q.client_signed_at,
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at) order by e.created_at)
        from public.events e
        where e.entity = 'quotes' and e.entity_id = q.id::text and e.action like 'quote.%'), '[]'::jsonb)
    ) order by q.requested_at)
    from public.quotes q join public.profiles p on p.id = q.created_by
    where q.source = 'app'
      and ((q.sent_at >= p_from and q.sent_at < p_to) or (q.sent_at is null and q.requested_at >= p_from and q.requested_at < p_to))
  ), '[]'::jsonb);
end $$;
revoke all on function public.ops_quote_journey(timestamptz, timestamptz) from public, anon;
grant execute on function public.ops_quote_journey(timestamptz, timestamptz) to authenticated;

commit;
