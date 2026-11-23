-- Helpers for seed_year_2026.sql (session-local). Same shapes as seed_1.6.sql, with fixed dates.
create or replace function pg_temp.uid(e text) returns uuid language sql as $$ select id from public.profiles where email = e $$;
create or replace function pg_temp.ts(d date, hm text) returns timestamptz language sql as $$ select (d + hm::time) at time zone 'Asia/Ho_Chi_Minh' $$;
create or replace function pg_temp.reg(t text, id text) returns void language sql as $$ insert into public.seed_registry (table_name, row_id) values (t, id) on conflict do nothing $$;
create or replace function pg_temp.person(p uuid) returns text language plpgsql as $$
declare v_name text;
begin
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = p;
  insert into public.lark_people (open_id, name, profile_id) values ('sim:' || p, v_name, p)
  on conflict (open_id) do update set name = excluded.name, profile_id = excluded.profile_id;
  return 'sim:' || p;
end $$;
create or replace function pg_temp.pname(p uuid) returns text language sql as $$ select coalesce(nullif(full_name, ''), email) from public.profiles where id = p $$;

create or replace function pg_temp.project(p_code text, p_name text, p_client text, p_pm uuid, p_start date, p_due date, p_color text, p_chat boolean) returns uuid language plpgsql as $$
declare v_id uuid; v_chat text;
begin
  if p_chat then
    v_chat := 'sim-chat:' || gen_random_uuid();
    insert into public.lark_chats (chat_id, name, mode) values (v_chat, p_code || ' - ' || p_name, 'simulation');
    perform pg_temp.reg('lark_chats', v_chat);
  end if;
  insert into public.lark_tasks (kind, code, name, client, assignee_open_id, assignee_name, pm_id, start_date, due_date, original_due_date, kpi_due_date,
                                 mode, lark_title, state, color, chat_id, chat_name, chat_status, source, created_by, created_at)
  values ('parent', p_code, p_name, p_client, pg_temp.person(p_pm), pg_temp.pname(p_pm), p_pm, p_start, p_due, p_due, p_due,
          'simulation', '[' || p_code || '] ' || p_name, 'active', p_color, v_chat, case when p_chat then p_code || ' - ' || p_name end,
          case when p_chat then 'linked' else 'none' end, 'web', p_pm, pg_temp.ts(p_start - 1, '08:30'))
  returning id into v_id;
  perform pg_temp.reg('lark_tasks', v_id::text);
  return v_id;
end $$;

create or replace function pg_temp.member(p_project uuid, p_who uuid, p_invited timestamptz) returns void language plpgsql as $$
begin
  insert into public.project_members (project_id, profile_id, open_id, name, source, status, invited_by, invited_at, responded_at)
  select p_project, p_who, pg_temp.person(p_who), pg_temp.pname(p_who), 'manual', 'accepted', t.pm_id, p_invited, p_invited + interval '2 hours'
  from public.lark_tasks t where t.id = p_project
  on conflict do nothing;
end $$;

create or replace function pg_temp.task(p_project uuid, p_name text, p_output text, p_who uuid, p_start date, p_due date, p_created timestamptz) returns uuid language plpgsql as $$
declare v_id uuid; v_seq int; v_code text; v_pcode text; v_pm uuid;
begin
  update public.lark_tasks set next_seq = next_seq + 1 where id = p_project returning next_seq - 1, code, pm_id into v_seq, v_pcode, v_pm;
  v_code := v_pcode || '-' || lpad(v_seq::text, 2, '0');
  insert into public.lark_tasks (kind, parent_id, parent_code, code, seq, name, expected_output, assignee_open_id, assignee_name, assignee_id,
                                 start_date, due_date, original_due_date, kpi_due_date, state, mode, lark_title, source, created_by, created_at)
  values ('child', p_project, v_pcode, v_code, v_seq, p_name, p_output, pg_temp.person(p_who), pg_temp.pname(p_who), p_who,
          p_start, p_due, p_due, p_due, 'doing', 'simulation', p_name || ' (' || v_code || ')', 'web', v_pm, p_created)
  returning id into v_id;
  perform pg_temp.reg('lark_tasks', v_id::text);
  return v_id;
end $$;

create or replace function pg_temp.submit(p_task uuid, p_at timestamptz, p_decision text, p_decided timestamptz, p_feedback text default null) returns void language plpgsql as $$
declare v_round int; v_code text; v_pm uuid; v_who uuid;
begin
  select t.code, p.pm_id, t.assignee_id into v_code, v_pm, v_who from public.lark_tasks t join public.lark_tasks p on p.id = t.parent_id where t.id = p_task;
  select coalesce(max(round), 0) + 1 into v_round from public.task_submissions where task_id = p_task;
  insert into public.task_submissions (task_id, round, via, submitted_by, submitted_at, note, links, decision, decided_by, decided_at, feedback)
  values (p_task, v_round, 'web', v_who, p_at, case when v_round > 1 then 'Đã sửa theo góp ý.' else 'Kết quả theo yêu cầu, nhờ anh/chị duyệt.' end,
          jsonb_build_array('https://drive.google.com/drive/folders/mau-' || lower(v_code) || '-lan-' || v_round),
          p_decision, v_pm, p_decided, p_feedback);
  if p_decision = 'approved' then
    update public.lark_tasks set state = 'done', accepted_at = p_at, approved_at = p_decided, approved_by = v_pm, closed_at = p_decided,
                                 completed_at = p_at, review_since = null where id = p_task;
  else
    update public.lark_tasks set state = 'changes', review_since = null, completed_at = null where id = p_task;
  end if;
end $$;

create or replace function pg_temp.checkin(p_task uuid, p_pct int, p_day date, p_answer text, p_reason text default null) returns void language sql as $$
  insert into public.task_checkins (task_id, pct, due_date, sent_at, answer, answer_reason, answered_at)
  values (p_task, p_pct, p_day, pg_temp.ts(p_day, '09:00'), p_answer, p_reason, pg_temp.ts(p_day, '10:15'))
  on conflict do nothing
$$;

create or replace function pg_temp.bot(p_project uuid, p_task uuid, p_kind text, p_msg text, p_who text, p_day date, p_at timestamptz, p_key text) returns void language sql as $$
  insert into public.bot_messages (project_id, task_id, kind, channel, chat_id, dedupe_key, local_date, status, attempts, message, sent_at, created_at)
  select p_project, p_task, p_kind, 'group', t.chat_id, p_key, p_day, 'simulated', 1, replace(p_msg, '§WHO§', p_who)::jsonb, p_at, p_at
  from public.lark_tasks t where t.id = p_project
  on conflict (dedupe_key) do nothing
$$;
