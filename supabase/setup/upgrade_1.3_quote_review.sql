-- =====================================================================================
-- Go Media Ops Hub · upgrade 1.2 → 1.3 (review comments on the quote). Adds one table only;
-- no drops, no change to existing data. Running 01_schema.sql 1.3 in full does the same.
-- =====================================================================================
begin;

-- 1.3 · Review on the quote itself: the PM / CEO opens the quote by its link and leaves comments
-- on the exact line, section or block that needs a fix; the Account replies and marks each one done.
-- A thread is a root comment (parent_id null) plus replies. Only roots carry the resolved state.
-- All writes go through the Edge Function (service role); signed-in users only read.
create table if not exists public.quote_comments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  parent_id uuid references public.quote_comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  anchor text not null default 'general' check (anchor in ('general','client','line','section','totals','terms')),
  -- The line a comment points at; null once that line is deleted (the label below still says which one).
  line_id uuid references public.quote_lines(id) on delete set null,
  section_title text,
  anchor_label text not null default '',
  body text not null check (length(trim(body)) between 1 and 2000),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists quote_comments_quote_idx on public.quote_comments(quote_id, created_at);
create index if not exists quote_comments_open_idx on public.quote_comments(quote_id) where parent_id is null and resolved_at is null;

revoke all on public.quote_comments from anon, authenticated;
grant select on public.quote_comments to authenticated;
grant all on public.quote_comments to service_role;
alter table public.quote_comments enable row level security;

-- Review comments are internal: the PM, CEO and Admin read all of them, an Account only those on
-- their own quotes (not on other people's sent quotes in the archive).
drop policy if exists quote_comments_read on public.quote_comments;
create policy quote_comments_read on public.quote_comments for select to authenticated
  using (public.has_role('pm','ceo','admin')
         or exists (select 1 from public.quotes q where q.id = quote_id and q.created_by = auth.uid()));
commit;
