-- =====================================================================================
-- Go Media Ops Hub · showcase data for 1.6 "Dự án & Task" (Pilot, Lark simulation mode)
-- Run once in Supabase → SQL Editor after upgrade_1.6.1. All people, clients and work are invented.
-- Dates are relative to today (Asia/Ho_Chi_Minh), so the data always looks current on the day it
-- is loaded. Every project, task and simulated group is listed in seed_registry, so
-- supabase/setup/clear_sample_data.sql removes it (tasks' submissions, members, check-ins cascade).
-- Stops without changes if project MT35 already exists.
-- =====================================================================================
create or replace function pg_temp.uid(e text) returns uuid language sql as $$ select id from public.profiles where email = e $$;
create or replace function pg_temp.ts(d date, hm text) returns timestamptz language sql as $$ select (d + hm::time) at time zone 'Asia/Ho_Chi_Minh' $$;
create or replace function pg_temp.reg(t text, id text) returns void language sql as $$ insert into public.seed_registry (table_name, row_id) values (t, id) on conflict do nothing $$;

-- Lark identity of a person in simulation ("sim:<profile id>").
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
          case when p_chat then 'linked' else 'missing' end, 'web', p_pm, pg_temp.ts(p_start, '08:30'))
  returning id into v_id;
  perform pg_temp.reg('lark_tasks', v_id::text);
  return v_id;
end $$;

create or replace function pg_temp.member(p_project uuid, p_who uuid, p_status text, p_invited timestamptz, p_reason text default null) returns void language plpgsql as $$
begin
  insert into public.project_members (project_id, profile_id, open_id, name, source, status, invited_by, invited_at, responded_at, decline_reason)
  select p_project, p_who, pg_temp.person(p_who), pg_temp.pname(p_who), 'manual', p_status, t.pm_id, p_invited,
         case when p_status <> 'invited' then p_invited + interval '2 hours' end, p_reason
  from public.lark_tasks t where t.id = p_project;
end $$;

create or replace function pg_temp.task(p_project uuid, p_name text, p_output text, p_who uuid, p_start date, p_due date,
                                        p_progress text default null, p_note text default null) returns uuid language plpgsql as $$
declare v_id uuid; v_seq int; v_code text; v_pcode text; v_pm uuid;
begin
  update public.lark_tasks set next_seq = next_seq + 1 where id = p_project returning next_seq - 1, code, pm_id into v_seq, v_pcode, v_pm;
  v_code := v_pcode || '-' || lpad(v_seq::text, 2, '0');
  insert into public.lark_tasks (kind, parent_id, parent_code, code, seq, name, expected_output, assignee_open_id, assignee_name, assignee_id,
                                 start_date, due_date, original_due_date, kpi_due_date, state, progress, progress_note, progress_at,
                                 mode, lark_title, source, created_by, created_at)
  values ('child', p_project, v_pcode, v_code, v_seq, p_name, p_output, pg_temp.person(p_who), pg_temp.pname(p_who), p_who,
          p_start, p_due, p_due, p_due, 'doing', p_progress, p_note, case when p_progress is not null then pg_temp.ts(p_start, '16:00') + interval '1 day' end,
          'simulation', p_name || ' (' || v_code || ')', 'web', v_pm, pg_temp.ts(p_start, '09:00'))
  returning id into v_id;
  perform pg_temp.reg('lark_tasks', v_id::text);
  return v_id;
end $$;

-- One submission. decision null = waiting for review; 'changes' = sent back; 'approved' = done.
create or replace function pg_temp.submit(p_task uuid, p_at timestamptz, p_decision text default null, p_decided timestamptz default null, p_feedback text default null) returns void language plpgsql as $$
declare v_round int; v_code text; v_pm uuid; v_who uuid;
begin
  select t.code, p.pm_id, t.assignee_id into v_code, v_pm, v_who from public.lark_tasks t join public.lark_tasks p on p.id = t.parent_id where t.id = p_task;
  select coalesce(max(round), 0) + 1 into v_round from public.task_submissions where task_id = p_task;
  insert into public.task_submissions (task_id, round, via, submitted_by, submitted_at, note, links, decision, decided_by, decided_at, feedback)
  values (p_task, v_round, 'web', v_who, p_at, case when v_round > 1 then 'Đã sửa theo góp ý.' else 'Kết quả theo yêu cầu, nhờ anh/chị duyệt.' end,
          jsonb_build_array('https://drive.google.com/drive/folders/mau-' || lower(v_code) || '-lan-' || v_round),
          p_decision, case when p_decision is not null then v_pm end, p_decided, p_feedback);
  if p_decision = 'approved' then
    update public.lark_tasks set state = 'done', accepted_at = p_at, approved_at = p_decided, approved_by = v_pm, closed_at = p_decided,
                                 completed_at = p_at, review_since = null, progress = null, progress_note = null where id = p_task;
  elsif p_decision = 'changes' then
    update public.lark_tasks set state = 'changes', review_since = null, completed_at = null, progress = null, progress_note = null where id = p_task;
  else
    update public.lark_tasks set state = 'review', review_since = p_at, completed_at = p_at where id = p_task;
  end if;
end $$;

create or replace function pg_temp.extend(p_task uuid, p_to date, p_reason text, p_at timestamptz, p_note text default null) returns void language plpgsql as $$
declare v_from date; v_pm uuid;
begin
  select t.due_date, p.pm_id into v_from, v_pm from public.lark_tasks t join public.lark_tasks p on p.id = t.parent_id where t.id = p_task;
  insert into public.task_extensions (task_id, from_date, to_date, reason, note, created_by, created_at) values (p_task, v_from, p_to, p_reason, p_note, v_pm, p_at);
  update public.lark_tasks set due_date = p_to, kpi_due_date = case when p_reason = 'scope' then p_to else kpi_due_date end where id = p_task;
end $$;

create or replace function pg_temp.checkin(p_task uuid, p_pct int, p_day date, p_answer text default null, p_reason text default null) returns void language sql as $$
  insert into public.task_checkins (task_id, pct, due_date, sent_at, answer, answer_reason, answered_at)
  values (p_task, p_pct, p_day, pg_temp.ts(p_day, '09:00'), p_answer, p_reason, case when p_answer is not null then pg_temp.ts(p_day, '10:15') end)
$$;

create or replace function pg_temp.cancel(p_task uuid, p_reason text, p_at timestamptz) returns void language sql as $$
  update public.lark_tasks set state = 'cancelled', cancel_reason = p_reason, cancelled_at = p_at, closed_at = p_at where id = p_task
$$;

do $$
declare
  d date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  pm_test uuid := pg_temp.uid('long.nguyen230608+pm@vnuk.edu.vn');
  pm_anh uuid := pg_temp.uid('anh.vq@gomedia.local');
  nv1 uuid := pg_temp.uid('long.nguyen230608+nv1@vnuk.edu.vn');
  nv2 uuid := pg_temp.uid('long.nguyen230608+nv2@vnuk.edu.vn');
  ngoc uuid := pg_temp.uid('ngoc.nb@gomedia.local');
  phuoc uuid := pg_temp.uid('phuoc.dh@gomedia.local');
  kiet uuid := pg_temp.uid('kiet.lt@gomedia.local');
  duyen uuid := pg_temp.uid('duyen.pm@gomedia.local');
  huy uuid := pg_temp.uid('huy.tg@gomedia.local');
  truc uuid := pg_temp.uid('truc.mt@gomedia.local');
  thinh uuid := pg_temp.uid('thinh.hd@gomedia.local');
  khang uuid := pg_temp.uid('khang.tm@gomedia.local');
  p uuid; t uuid;
begin
  if exists (select 1 from public.lark_tasks where kind = 'parent' and upper(code) = 'MT35' and deleted_at is null) then
    raise notice 'MT35 already exists: showcase 1.6 not loaded again.';
    return;
  end if;
  if pm_test is null or nv1 is null or nv2 is null or pm_anh is null then
    raise exception 'missing test or showcase accounts';
  end if;
  -- the three test accounts are test data too
  perform pg_temp.reg('auth.users', pm_test::text);
  perform pg_temp.reg('auth.users', nv1::text);
  perform pg_temp.reg('auth.users', nv2::text);

  -- ============================ PM Thử nghiệm ============================
  -- MT35: a live project with every kind of task state
  p := pg_temp.project('MT35', 'Ra mắt BST Tết 2027', 'Thời trang Mộc Trà (mẫu)', pm_test, d - 14, d + 21, '#2F5BD3', true);
  perform pg_temp.member(p, nv1, 'accepted', pg_temp.ts(d - 14, '09:00'));
  perform pg_temp.member(p, nv2, 'accepted', pg_temp.ts(d - 14, '09:00'));
  perform pg_temp.member(p, ngoc, 'accepted', pg_temp.ts(d - 13, '09:00'));
  perform pg_temp.member(p, kiet, 'invited', pg_temp.ts(d - 1, '15:00'));
  t := pg_temp.task(p, 'Chốt moodboard và concept BST', 'Moodboard 20 hình + 1 trang concept đã gửi khách', nv1, d - 14, d - 9);
  perform pg_temp.submit(t, pg_temp.ts(d - 10, '16:20'), 'approved', pg_temp.ts(d - 9, '09:40'));
  t := pg_temp.task(p, 'Book 30 KOC thời trang', 'Danh sách 30 KOC đã xác nhận, kèm rate card', nv2, d - 12, d - 4);
  perform pg_temp.submit(t, pg_temp.ts(d - 5, '17:00'), 'changes', pg_temp.ts(d - 4, '10:00'), 'Mới có 22 KOC xác nhận, còn thiếu 8. Ưu tiên KOC dưới 50k follower.');
  perform pg_temp.extend(t, d - 2, 'quality', pg_temp.ts(d - 4, '10:00'), 'Bổ sung 8 KOC');
  perform pg_temp.submit(t, pg_temp.ts(d - 3, '18:10'), 'approved', pg_temp.ts(d - 2, '09:15'));
  t := pg_temp.task(p, 'Quay 10 video lookbook', '10 video 9:16, đã dựng, có phụ đề', nv1, d - 7, d + 3);
  perform pg_temp.checkin(t, 50, d - 2, 'on_plan');
  perform pg_temp.submit(t, pg_temp.ts(d, '08:45'));
  t := pg_temp.task(p, 'Viết caption 30 bài đăng', 'File caption 30 bài theo lịch đăng', nv2, d - 5, d - 1);
  t := pg_temp.task(p, 'Thiết kế banner sàn TMĐT', 'Bộ banner Shopee + Lazada + TikTok Shop (6 kích thước)', ngoc, d - 3, d, 'on_plan');
  t := pg_temp.task(p, 'Lên lịch livestream 2 tuần', 'Lịch live 14 ngày, có host và sản phẩm từng buổi', nv1, d - 6, d + 8);
  perform pg_temp.checkin(t, 50, d - 3);
  t := pg_temp.task(p, 'Đặt quà tặng gửi KOC', '30 set quà đã đặt, có mã vận đơn', nv2, d - 2, d + 10, 'blocked', 'Nhà cung cấp hộp quà chưa báo giá, cần PM duyệt nhà cung cấp khác');

  -- LS12: invitations answered both ways, a task sent back, one behind schedule
  p := pg_temp.project('LS12', 'Livestream Shopee 12.12', 'Mỹ phẩm Lumi (mẫu)', pm_test, d - 5, d + 20, '#D9822B', true);
  perform pg_temp.member(p, nv1, 'accepted', pg_temp.ts(d - 5, '09:00'));
  perform pg_temp.member(p, nv2, 'accepted', pg_temp.ts(d - 5, '09:00'));
  perform pg_temp.member(p, huy, 'accepted', pg_temp.ts(d - 5, '09:10'));
  perform pg_temp.member(p, duyen, 'declined', pg_temp.ts(d - 4, '09:00'), 'Đang kín lịch với dự án SEO08 tới giữa tháng 12, xin phép không nhận thêm.');
  t := pg_temp.task(p, 'Viết kịch bản 3 buổi live', 'Kịch bản chi tiết 3 buổi, có timeline và câu chốt sale', nv2, d - 5, d + 4, 'behind', 'Brand chưa duyệt danh sách sản phẩm đẩy');
  t := pg_temp.task(p, 'Chuẩn bị voucher và mini game', 'Bảng voucher + luật mini game đã cài trên Shopee', nv1, d - 4, d + 2);
  perform pg_temp.submit(t, pg_temp.ts(d - 1, '17:30'), 'changes', pg_temp.ts(d, '09:20'), 'Voucher giảm tối đa đang để 80k, khung khách duyệt là 50k. Sửa lại và thêm điều kiện đơn tối thiểu.');
  t := pg_temp.task(p, 'Thuê host và trợ live', 'Hợp đồng host + 1 trợ live cho 3 buổi', huy, d - 3, d + 6);
  perform pg_temp.submit(t, pg_temp.ts(d, '09:05'));
  t := pg_temp.task(p, 'Setup phòng live', 'Ảnh phòng live, đèn, mic, test stream 30 phút', nv1, d - 1, d + 9, 'on_plan');

  -- BN07: a finished project (one task cancelled)
  p := pg_temp.project('BN07', 'Banner sàn tháng 11', 'Gia dụng Mộc An (mẫu)', pm_test, d - 30, d - 5, '#2E8B57', true);
  perform pg_temp.member(p, nv2, 'accepted', pg_temp.ts(d - 30, '09:00'));
  perform pg_temp.member(p, truc, 'accepted', pg_temp.ts(d - 30, '09:00'));
  t := pg_temp.task(p, 'Banner Shopee 11.11', '6 banner Shopee đúng kích thước sàn', nv2, d - 30, d - 20);
  perform pg_temp.submit(t, pg_temp.ts(d - 21, '15:00'), 'approved', pg_temp.ts(d - 21, '17:30'));
  t := pg_temp.task(p, 'Banner Lazada 11.11', '6 banner Lazada đúng kích thước sàn', truc, d - 28, d - 18);
  perform pg_temp.submit(t, pg_temp.ts(d - 18, '11:00'), 'approved', pg_temp.ts(d - 17, '09:00'));
  t := pg_temp.task(p, 'Banner TikTok Shop', '4 banner TikTok Shop', nv2, d - 20, d - 8);
  perform pg_temp.cancel(t, 'Khách bỏ hạng mục TikTok Shop', pg_temp.ts(d - 15, '10:00'));
  update public.lark_tasks set state = 'done', closed_at = pg_temp.ts(d - 17, '09:00') where id = p;

  -- KV20: starts next week; Nhân sự 1 has not answered the invitation yet
  p := pg_temp.project('KV20', 'Key visual Valentine', 'Trà sữa Mây (mẫu)', pm_test, d + 3, d + 40, '#8A4FC7', false);
  perform pg_temp.member(p, nv2, 'accepted', pg_temp.ts(d - 1, '10:00'));
  perform pg_temp.member(p, nv1, 'invited', pg_temp.ts(d, '08:30'));
  t := pg_temp.task(p, 'Brief và 3 hướng concept', '3 hướng concept key visual, mỗi hướng 1 trang', nv2, d + 3, d + 10);

  -- ============================ PM Võ Quỳnh Anh ============================
  p := pg_temp.project('KOC21', 'Booking 200 KOC TikTok', 'Sữa hạt Nắng (mẫu)', pm_anh, d - 20, d + 10, '#C0392B', true);
  perform pg_temp.member(p, ngoc, 'accepted', pg_temp.ts(d - 20, '09:00'));
  perform pg_temp.member(p, phuoc, 'accepted', pg_temp.ts(d - 20, '09:00'));
  perform pg_temp.member(p, kiet, 'accepted', pg_temp.ts(d - 20, '09:00'));
  perform pg_temp.member(p, huy, 'accepted', pg_temp.ts(d - 20, '09:00'));
  perform pg_temp.member(p, thinh, 'accepted', pg_temp.ts(d - 19, '09:00'));
  t := pg_temp.task(p, 'Lọc 300 KOC tiềm năng', 'File 300 KOC có view TB, ER, giá', ngoc, d - 20, d - 14);
  perform pg_temp.submit(t, pg_temp.ts(d - 15, '16:00'), 'approved', pg_temp.ts(d - 14, '10:00'));
  t := pg_temp.task(p, 'Gửi brief đợt 1 (100 KOC)', '100 KOC đã nhận brief, có xác nhận', phuoc, d - 14, d - 7);
  perform pg_temp.submit(t, pg_temp.ts(d - 7, '17:45'), 'approved', pg_temp.ts(d - 6, '09:00'));
  t := pg_temp.task(p, 'Gửi brief đợt 2 (100 KOC)', '100 KOC còn lại đã nhận brief', kiet, d - 10, d - 2);
  perform pg_temp.submit(t, pg_temp.ts(d - 4, '16:30'));
  t := pg_temp.task(p, 'Thu 120 video đợt 1', '120 video đã đăng, file tổng hợp link', huy, d - 8, d - 1);
  perform pg_temp.checkin(t, 50, d - 4, 'behind', 'Nhiều KOC xin lùi lịch đăng');
  t := pg_temp.task(p, 'Đối soát chi phí KOC', 'Bảng đối soát có chứng từ chuyển khoản', thinh, d - 3, d + 7, 'blocked', 'Kế toán chưa gửi sao kê tháng 11');
  t := pg_temp.task(p, 'Báo cáo hiệu quả giữa kỳ', 'Slide 10 trang: view, ER, chi phí/view', ngoc, d - 2, d + 8);

  p := pg_temp.project('SEO08', 'Thiết lập SEO website', 'Nội thất Gỗ Việt (mẫu)', pm_anh, d - 10, d + 25, '#1C8C9E', true);
  perform pg_temp.member(p, duyen, 'accepted', pg_temp.ts(d - 10, '09:00'));
  perform pg_temp.member(p, truc, 'accepted', pg_temp.ts(d - 10, '09:00'));
  perform pg_temp.member(p, khang, 'accepted', pg_temp.ts(d - 9, '09:00'));
  t := pg_temp.task(p, 'Chốt bộ từ khoá', '150 từ khoá chia cụm theo trang', duyen, d - 10, d - 6);
  perform pg_temp.submit(t, pg_temp.ts(d - 6, '15:00'), 'approved', pg_temp.ts(d - 5, '09:30'));
  t := pg_temp.task(p, 'Viết meta 40 trang', 'File meta title/description 40 trang', truc, d - 6, d + 1);
  perform pg_temp.submit(t, pg_temp.ts(d - 2, '16:00'), 'changes', pg_temp.ts(d - 1, '09:00'), 'Khách muốn thêm 15 trang danh mục mới, làm luôn cho đủ.');
  perform pg_temp.extend(t, d + 5, 'scope', pg_temp.ts(d - 1, '09:00'), 'Khách thêm 15 trang');
  t := pg_temp.task(p, 'Đưa meta lên website', 'Ảnh chụp CMS + danh sách URL đã cập nhật', khang, d - 1, d + 12);
  t := pg_temp.task(p, 'QA kỹ thuật SEO', 'Báo cáo QA: tốc độ, index, lỗi 404', duyen, d, d + 20);

  p := pg_temp.project('VID15', 'Video sản phẩm quý 1', 'Bánh Đồng Quê (mẫu)', pm_anh, d - 2, d + 45, '#B8860B', false);
  perform pg_temp.member(p, phuoc, 'accepted', pg_temp.ts(d - 2, '09:00'));
  perform pg_temp.member(p, huy, 'accepted', pg_temp.ts(d - 2, '09:00'));
  perform pg_temp.member(p, nv1, 'accepted', pg_temp.ts(d - 2, '09:30'));
  t := pg_temp.task(p, 'Kịch bản 6 video sản phẩm', '6 kịch bản đã được khách duyệt', nv1, d - 2, d + 12);
  t := pg_temp.task(p, 'Nhận đủ sản phẩm mẫu', 'Ảnh kho: 6 dòng bánh, mỗi dòng 5 hộp', phuoc, d - 2, d + 2);
  t := pg_temp.task(p, 'Book studio quay', 'Hợp đồng studio 2 ngày quay', huy, d - 1, d + 6);
  perform pg_temp.submit(t, pg_temp.ts(d, '09:30'));
end $$;

select code, state, (select count(*) from public.lark_tasks c where c.parent_id = p.id) as tasks,
       (select count(*) from public.project_members m where m.project_id = p.id) as members
from public.lark_tasks p where kind = 'parent' and code in ('MT35','LS12','BN07','KV20','KOC21','SEO08','VID15') order by code;
