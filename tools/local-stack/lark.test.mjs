// S1 on Lark, end to end against the mock Lark Open Platform in server.mjs: bot commands, code checks,
// preview + confirm, tasks created on Lark Tasks, 09:00 reminders with @mention, no duplicates, deadline
// and assignee changes, send failures and retry, completion only with valid codes, simulation mode.
// Needs: Postgres :54322 with the schema, and `node tools/local-stack/server.mjs` running.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const API = 'http://127.0.0.1:54321';
const keys = await (await fetch(`${API}/__test/keys`)).json();
const service = createClient(API, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = async (q, params = []) => {
  const res = await fetch(`${API}/__test/sql`, { method: 'POST', body: JSON.stringify({ sql: q, params }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.msg ?? `SQL failed (${res.status})`);
  return body.rows;
};
const larkState = async () => (await fetch(`${API}/__test/lark`)).json();
const larkSet = (b) => fetch(`${API}/__test/lark`, { method: 'POST', body: JSON.stringify(b) });
const TOKEN = 'verify-token-123';
// Clock: Tuesday 01/12/2026 in Đà Nẵng (UTC+7).
const at = (day, hm) => new Date(Date.parse(`2026-12-${String(day).padStart(2, '0')}T${hm}:00+07:00`)).toISOString();
let seq = 0;

async function event(body, now = at(1, '08:00')) {
  const res = await fetch(`${API}/functions/v1/ops-hub/lark-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-now': now },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const say = (text, { from = 'ou_exec', mentions = [{ key: '@_user_1', id: { open_id: 'ou_tram' }, name: 'Nguyễn Thị Ngọc Trâm' }], eventId, now } = {}) =>
  event(
    {
      schema: '2.0',
      header: { event_id: eventId ?? `ev-${++seq}`, event_type: 'im.message.receive_v1', token: TOKEN },
      event: { sender: { sender_id: { open_id: from } }, message: { message_id: `om_in_${seq}`, chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }), mentions } },
    },
    now,
  );
const press = (draft, op, from = 'ou_exec', now) =>
  event({ schema: '2.0', header: { event_id: `ev-${++seq}`, event_type: 'card.action.trigger', token: TOKEN }, event: { operator: { open_id: from }, action: { value: { op, draft } } } }, now);
const lastReply = async () => {
  const s = await larkState();
  const replies = s.messages.filter((m) => m.path.includes('/reply'));
  return replies[replies.length - 1]?.card;
};
const cardText = (card) => JSON.stringify(card);
async function cron(now) {
  const [{ s }] = await sql(`select public.ops_cron_secret() as s`);
  const res = await fetch(`${API}/functions/v1/ops-hub/dispatch-checkpoints`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': s, 'x-test-now': now }, body: '{}' });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.lark;
}
const groupCards = async () => (await larkState()).messages.filter((m) => m.receive_id === 'oc_group');

async function signIn(email) {
  const c = createClient(API, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e1 } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (e1) throw e1;
  const { code } = await (await fetch(`${API}/__test/otp?email=${encodeURIComponent(email)}`)).json();
  const { error } = await c.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw error;
  return c;
}
async function api(client, body, now) {
  const { data, error } = await client.functions.invoke('ops-hub/api', { body, headers: now ? { 'x-test-now': now } : {} });
  if (error) {
    let msg = error.message;
    try {
      const j = await error.context.json();
      msg = `${j.error?.code}: ${j.error?.message}`;
    } catch {}
    throw new Error(msg);
  }
  return data;
}

let admin;
before(async () => {
  await sql(`truncate public.lark_notifications, public.lark_drafts, public.lark_events, public.lark_people restart identity cascade`);
  await sql(`delete from public.lark_tasks`);
  await sql(`insert into vault.secrets (name, secret) values ('ops_cron_secret', 'local-cron-secret') on conflict (name) do nothing`);
  await sql(`select public.ops_set_lark_secret('lark_app_secret', 'lark-test-secret'), public.ops_set_lark_secret('lark_verification_token', $1)`, [TOKEN]);
  await sql(`update public.settings set lark_mode = 'live', lark_app_id = 'cli_test_app', lark_chat_id = 'oc_group', lark_notify_time = '09:00', lark_notify_d0 = false,
             lark_parent_pattern = '^[A-Z]{2}\\d{3}$', lark_child_pattern = '^{PARENT}-\\d{2}-S\\d{2}$', timezone = 'Asia/Ho_Chi_Minh'`);
  await fetch(`${API}/__test/lark`, { method: 'DELETE' });
  const email = 'lark-admin@go.vn';
  const [exists] = await sql(`select id from auth.users where email = $1`, [email]);
  if (!exists) await service.auth.admin.createUser({ email, email_confirm: true });
  await sql(`update public.profiles set role = 'admin', active = true, full_name = 'Admin Lark' where email = $1`, [email]);
  admin = await signIn(email);
});

test('Lark endpoint: verification token and URL challenge', async () => {
  assert.equal((await event({ type: 'url_verification', token: 'wrong', challenge: 'x' })).status, 401);
  assert.deepEqual((await event({ type: 'url_verification', token: TOKEN, challenge: 'abc' })).body, { challenge: 'abc' });
  assert.equal((await event({ encrypt: 'xxx' })).status, 400);
});

let parentDraft;
test('Bot · step 8 cases 1–5: codes checked before anything is created', async () => {
  await say('xin chào');
  assert.match(cardText(await lastReply()), /Hướng dẫn tạo task/);

  await say('/taomoi me D56 | [STING] Quản lý 1600 KOC video Freecast | @_user_1 | 31/12/2026');
  assert.match(cardText(await lastReply()), /sai format/);
  assert.equal((await larkState()).tasks.length, 0);

  await say('/taomoi me DA056 | [STING] Quản lý 1600 KOC video Freecast | @_user_1 | 31/12/2026', { eventId: 'ev-dup' });
  const preview = await lastReply();
  assert.match(cardText(preview), /Xác nhận tạo task mẹ/);
  assert.match(cardText(preview), /<at id=ou_tram><\/at>/);
  parentDraft = preview.elements.find((e) => e.tag === 'action').actions[0].value.draft;
  const before = (await larkState()).messages.length;
  await say('/taomoi me DA056 | x | @_user_1 | 31/12/2026', { eventId: 'ev-dup' }); // Lark re-delivery: ignored
  assert.equal((await larkState()).messages.length, before);

  const wrongPerson = await press(parentDraft, 'confirm', 'ou_someone_else');
  assert.match(JSON.stringify(wrongPerson.body), /Chỉ người gửi lệnh/);
  const ok = await press(parentDraft, 'confirm');
  assert.equal(ok.body.toast.type, 'success');
  const again = await press(parentDraft, 'confirm'); // double click
  assert.match(JSON.stringify(again.body), /đã được xử lý/);
  const s = await larkState();
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].summary, '[DA056] [STING] Quản lý 1600 KOC video Freecast');
  assert.deepEqual(s.tasks[0].members, [{ id: 'ou_tram', type: 'user', role: 'assignee' }]);
  assert.deepEqual(s.tasks[0].due, { timestamp: String(Date.parse('2026-12-31T00:00:00Z')), is_all_day: true });

  await say('/taomoi con DA056-4-S44 | Push 50 KOC | @_user_1 | 04/12/2026');
  assert.match(cardText(await lastReply()), /sai format/);
  await say('/taomoi con DA057-04-S44 | Push 50 KOC | @_user_1 | 04/12/2026');
  assert.match(cardText(await lastReply()), /Chưa có task mẹ DA057/);
  await say('/taomoi con DA056-04-S44 | Push 50 KOC | @_user_1 | 05/01/2027');
  assert.match(cardText(await lastReply()), /sau deadline tổng/);
  assert.equal((await larkState()).tasks.length, 1);
});

test('Bot · sub-tasks created under the parent on Lark, confirmed by button or by replying "xác nhận"', async () => {
  for (const [code, name, due] of [
    ['DA056-04-S44', '[STING] Push 50 KOC gửi đủ số lượng video', '04/12/2026'],
    ['DA056-04-S45', '[STING] Duyệt kịch bản video', '02/12/2026'],
    ['DA056-04-S46', '[STING] Gửi báo cáo tuần', '01/12/2026'],
  ]) {
    await say(`/taomoi con ${code} | ${name} | @_user_1 | ${due}`);
    const card = await lastReply();
    assert.match(cardText(card), /Xác nhận tạo task con/);
    assert.match(cardText(card), /\[DA056\] \[STING\] Quản lý 1600 KOC video Freecast/);
    if (code.endsWith('S44')) await press(card.elements.find((e) => e.tag === 'action').actions[0].value.draft, 'confirm');
    else await say('xác nhận');
  }
  const s = await larkState();
  assert.equal(s.tasks.filter((t) => t.parent === s.tasks[0].guid).length, 3);
  assert.equal(s.tasks[1].summary, '[STING] Push 50 KOC gửi đủ số lượng video (DA056-04-S44)');
  const rows = await sql(`select code, mode, lark_guid is not null as on_lark from public.lark_tasks where kind = 'child' order by code`);
  assert.deepEqual(rows.map((r) => [r.code, r.mode, r.on_lark]), [
    ['DA056-04-S44', 'live', true],
    ['DA056-04-S45', 'live', true],
    ['DA056-04-S46', 'live', true],
  ]);
});

test('Reminders · step 8 cases 6–17 on the daily run', async () => {
  // 01/12 08:00 — before 09:00 nothing goes out.
  let r = await cron(at(1, '08:00'));
  assert.equal(r.reminders, 0);
  assert.equal(r.waitingForTime, 2); // S44 (D-3) and S45 (D-1); S46 is due today (D0: no message)
  // 09:05 — D-3 and D-1, each tagging the assignee, in the CEO format.
  r = await cron(at(1, '09:05'));
  assert.equal(r.reminders, 2);
  let cards = await groupCards();
  assert.equal(cards.length, 2);
  const titles = cards.map((c) => c.card.header.title.content).sort();
  assert.deepEqual(titles, ['🔴 Task sắp đến hạn – Còn 1 ngày!', '🔴 Task sắp đến hạn – Còn 3 ngày!']);
  const s44 = cards.find((c) => c.card.header.title.content.includes('3 ngày')).card;
  assert.equal(s44.header.template, 'orange');
  assert.match(s44.elements[0].text.content, /📌 \*\*Task mẹ:\*\* \[DA056\] \[STING\] Quản lý 1600 KOC video Freecast/);
  assert.match(s44.elements[0].text.content, /🔸 \*\*Task con:\*\* \[STING\] Push 50 KOC gửi đủ số lượng video \(DA056-04-S44\)/);
  assert.match(s44.elements[0].text.content, /👤 \*\*Người thực hiện:\*\* <at id=ou_tram><\/at>/);
  assert.match(s44.elements[0].text.content, /⏰ \*\*Hạn chót:\*\* 04\/12\/2026/);
  // A second run the same day sends nothing new.
  r = await cron(at(1, '09:20'));
  assert.equal(r.reminders, 0);
  assert.equal((await groupCards()).length, 2);

  // 02/12: S44 D-2, S45 is due today (nothing), S46 one day late (red, D+1).
  r = await cron(at(2, '09:00'));
  assert.equal(r.reminders, 2);
  cards = await groupCards();
  const d1 = cards.find((c) => c.card.header.title.content.includes('Chưa hoàn thành')).card;
  assert.equal(d1.header.template, 'red');
  assert.match(JSON.stringify(d1), /Đã quá hạn 1 ngày/);

  // Changes made on Lark: S44 deadline moved to 10/12, S46 handed to someone else, S45 Completed.
  const s = await larkState();
  const guid = (code) => s.tasks.find((t) => t.summary.includes(code)).guid;
  await larkSet({ guid: guid('S44'), patch: { due: { timestamp: String(Date.parse('2026-12-10T00:00:00Z')), is_all_day: true } } });
  await larkSet({ guid: guid('S46'), patch: { members: [{ id: 'ou_new', type: 'user', role: 'assignee', name: 'Người mới' }] } });
  await larkSet({ guid: guid('S45'), patch: { completed_at: String(Date.parse(at(2, '15:00'))) } });
  await larkSet({ failSends: 1 });

  // 03/12 09:00: S45 confirmed done (green card, then never again); S44 now D-7 (nothing);
  // S46 D+2 to the new person — the first send fails and is retried on the next run.
  r = await cron(at(3, '09:00'));
  assert.equal(r.completions + r.reminders + r.failed, 2);
  assert.equal(r.failed, 1);
  r = await cron(at(3, '09:15'));
  assert.equal(r.failed, 0);
  const day3 = (await groupCards()).slice(-2).map((c) => JSON.stringify(c.card));
  assert.ok(day3.some((c) => c.includes('✅ Task đã hoàn thành!') && c.includes('Task: [DA056-04-S45] – DONE')));
  assert.ok(day3.some((c) => c.includes('<at id=ou_new></at>') && c.includes('Đã quá hạn 2 ngày')));
  // The failed message was sent again on the next run (attempt 2); nothing was lost or doubled.
  const day3rows = await sql(`select attempts, status from public.lark_notifications where local_date = '2026-12-03' order by attempts`);
  assert.deepEqual(day3rows.map((x) => [x.attempts, x.status]), [[1, 'sent'], [2, 'sent']]);
  const [s45] = await sql(`select closed_at is not null as closed from public.lark_tasks where code = 'DA056-04-S45'`);
  assert.equal(s45.closed, true);

  // S46 is marked Completed but someone broke the code in its title: keep reminding, say why.
  await larkSet({ guid: guid('S46'), patch: { completed_at: String(Date.parse(at(3, '16:00'))), summary: '[STING] Gửi báo cáo tuần (DA056-4-S46)' } });
  r = await cron(at(4, '09:00'));
  const broken = (await groupCards()).at(-1).card;
  assert.match(JSON.stringify(broken), /Task đã Completed nhưng mã chưa hợp lệ/);
  const [s46] = await sql(`select closed_at is null as open, code_errors from public.lark_tasks where lark_guid = $1`, [guid('S46')]);
  assert.equal(s46.open, true);
  assert.ok(s46.code_errors.length > 0);
  // Code fixed on Lark: completion confirmed on the next run, reminders stop.
  await larkSet({ guid: guid('S46'), patch: { summary: '[STING] Gửi báo cáo tuần (DA056-04-S46)' } });
  r = await cron(at(4, '09:15'));
  assert.equal(r.completions, 1);
  const s46Cards = async () => (await groupCards()).filter((c) => JSON.stringify(c.card).includes('S46')).length;
  const beforeDay5 = await s46Cards();
  r = await cron(at(5, '09:00'));
  assert.equal(await s46Cards(), beforeDay5);

  // History: one row per task, day and kind.
  const [{ dup }] = await sql(`select count(*) - count(distinct (task_id, local_date, kind)) as dup from public.lark_notifications`);
  assert.equal(Number(dup), 0);
});

test('Simulation mode from the web: same rules without a Lark app', async () => {
  await sql(`update public.settings set lark_mode = 'simulation'`);
  await api(admin, { action: 'lark.people' });
  const [me] = await sql(`select open_id from public.lark_people where name = 'Admin Lark'`);
  const dry = await api(admin, { action: 'lark.create', kind: 'parent', code: 'XX1', name: 'A', assignee_open_id: me.open_id, due_date: '2026-12-20', dry_run: true }, at(1, '10:00'));
  assert.match(dry.errors[0], /sai format/);
  await api(admin, { action: 'lark.create', kind: 'parent', code: 'MK101', name: 'Chiến dịch 12.12', assignee_open_id: me.open_id, due_date: '2026-12-20' }, at(1, '10:00'));
  await assert.rejects(api(admin, { action: 'lark.create', kind: 'child', code: 'MK102-01-S01', name: 'Banner', assignee_open_id: me.open_id, due_date: '2026-12-04' }, at(1, '10:00')), /Chưa có task mẹ MK102/);
  const { task } = await api(admin, { action: 'lark.create', kind: 'child', code: 'MK101-01-S01', name: 'Banner', assignee_open_id: me.open_id, due_date: '2026-12-04' }, at(1, '10:00'));
  assert.equal(task.mode, 'simulation');
  const before = (await larkState()).calls.length;
  const run = await api(admin, { action: 'lark.run' }, at(1, '10:00'));
  assert.equal(run.reminders, 1);
  assert.equal((await larkState()).calls.length, before); // Lark never called
  const [n] = await sql(`select status, message->>'title' as title from public.lark_notifications where task_id = $1`, [task.id]);
  assert.deepEqual([n.status, n.title], ['simulated', '🔴 Task sắp đến hạn – Còn 3 ngày!']);
  await api(admin, { action: 'lark.simulate', task_id: task.id, op: 'complete' }, at(1, '11:00'));
  const done = await api(admin, { action: 'lark.run' }, at(1, '11:00'));
  assert.equal(done.completions, 1);
});

test('Admin · Lark settings: code rules are checked, secrets go to Vault', async () => {
  await assert.rejects(api(admin, { action: 'lark.config', lark_child_pattern: '^\\d{2}$' }), /\{PARENT\}/);
  const st = await api(admin, { action: 'lark.config', lark_notify_d0: true, verification_token: 'new-token' });
  assert.equal(st.hasVerificationToken, true);
  assert.match(st.eventsUrl, /\/ops-hub\/lark-events$/);
  const [{ v }] = await sql(`select public.ops_lark_secrets()->>'verification_token' as v`);
  assert.equal(v, 'new-token');
  await sql(`select public.ops_set_lark_secret('lark_verification_token', $1)`, [TOKEN]);
  await sql(`update public.settings set lark_notify_d0 = false`);
});
