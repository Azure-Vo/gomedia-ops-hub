// End-to-end API tests: supabase-js → local gateway → PostgREST/RLS + the real Edge Function code.
// Needs: Postgres :54322 with the schema, and `node tools/local-stack/server.mjs` running.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const API = 'http://127.0.0.1:54321';
const keys = await (await fetch(`${API}/__test/keys`)).json();
const service = createClient(API, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
const WEBHOOK_SECRET = createHmac('sha256', keys.botToken).update('go-media-ops-hub/telegram-webhook').digest('hex');

const sql = async (q, params = []) => {
  const res = await fetch(`${API}/__test/sql`, { method: 'POST', body: JSON.stringify({ sql: q, params }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.msg ?? `SQL failed (${res.status})`);
  return body.rows;
};
const tgCalls = async () => (await (await fetch(`${API}/__test/telegram`)).json()).calls;
const tgReset = () => fetch(`${API}/__test/telegram`, { method: 'DELETE' });

// A fixed future working week (Mon–Fri) so the test does not depend on today's clock.
function vn(dayOffsetFromNextMonday, hm) {
  const [h, m] = hm.split(':').map(Number);
  const now = new Date(Date.now() + 7 * 3600e3);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const wd = new Date(today).getUTCDay();
  const toMonday = ((8 - wd) % 7) || 7;
  return new Date(today + (toMonday + 7 + dayOffsetFromNextMonday) * 86400e3 + (h * 60 + m) * 60e3 - 7 * 3600e3).toISOString();
}

const U = {};
const C = {};
const chat = { staff1: 7001, exec: 7002, pm: 7003, ceo: 7004, acc1: 7005 };

async function signIn(email) {
  const c = createClient(API, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e1 } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (e1) throw e1;
  const { code } = await (await fetch(`${API}/__test/otp?email=${encodeURIComponent(email)}`)).json();
  const { error } = await c.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw error;
  return c;
}

/** Calls the ops-hub API as a signed-in client; returns data or throws with the Vietnamese message. */
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

async function webhook(update, secret = WEBHOOK_SECRET) {
  const res = await fetch(`${API}/functions/v1/ops-hub/telegram-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: Date.now(), ...update }),
  });
  return res.status;
}

async function cron(route, now, secretOverride) {
  const [{ s }] = await sql(`select public.ops_cron_secret() as s`);
  const res = await fetch(`${API}/functions/v1/ops-hub/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secretOverride ?? s, 'x-test-now': now },
    body: '{}',
  });
  return { status: res.status, body: await res.json() };
}

const msgTo = (calls, chatId) => calls.filter((c) => c.method === 'sendMessage' && c.body.chat_id === chatId);

before(async () => {
  await sql(`truncate public.events, public.alerts, public.checkpoints, public.milestones, public.tasks, public.approvals,
             public.quote_lines, public.quotes, public.library_items restart identity cascade`);
  await sql(`alter table public.profiles disable trigger protect_last_admin`);
  await sql(`delete from auth.users`);
  await sql(`alter table public.profiles enable trigger protect_last_admin`);
  await sql(`update public.settings set no_reply_window_hours = 2, holidays = '{}', system_status = '{}', app_url = 'http://127.0.0.1:54340'`);
  await sql(`insert into vault.secrets (name, secret) values ('ops_cron_secret', 'local-cron-secret') on conflict (name) do nothing`);
  // First admin is created the way the guide says: a user added in Auth (inactive: the app did not make it),
  // then supabase/setup/03_first_admin.sql with the e-mail filled in.
  const { data: a } = await service.auth.admin.createUser({ email: 'admin@go.vn', email_confirm: true });
  const [before] = await sql(`select active from public.profiles where id = $1`, [a.user.id]);
  assert.equal(before.active, false);
  const bootstrap = readFileSync(new URL('../../supabase/setup/03_first_admin.sql', import.meta.url), 'utf8');
  await assert.rejects(sql(bootstrap), /Hãy thay YOUR-EMAIL/);
  await sql(bootstrap.replaceAll('YOUR-EMAIL@example.com', 'Admin@Go.vn'));
  await sql(`update public.profiles set full_name = 'Admin' where id = $1`, [a.user.id]);
  U.admin = a.user.id;
  C.admin = await signIn('admin@go.vn');
  for (const [k, role, name] of [
    ['acc1', 'account', 'Account Một'],
    ['acc2', 'account', 'Account Hai'],
    ['pm', 'pm', 'PM'],
    ['ceo', 'ceo', 'CEO'],
    ['exec', 'ecom_exec', 'E-com Exec'],
    ['staff1', 'staff', 'Intern 1'],
    ['staff2', 'staff', 'Intern 2'],
  ]) {
    const r = await api(C.admin, { action: 'admin.invite', email: `${k}@go.vn`, full_name: name, role });
    U[k] = r.user_id;
    C[k] = await signIn(`${k}@go.vn`);
  }
  // Telegram links via /start <code>
  for (const k of ['staff1', 'exec', 'pm', 'ceo', 'acc1']) {
    const { data } = await C[k].rpc('new_telegram_link_code');
    assert.equal(await webhook({ message: { message_id: 1, chat: { id: chat[k], type: 'private' }, text: `/start ${data.code}` } }), 200);
  }
});

test('admin invite, roles and Telegram linking', async () => {
  const rows = await sql(`select email, role, telegram_chat_id from public.profiles order by email`);
  assert.equal(rows.length, 8);
  assert.equal(rows.find((r) => r.email === 'exec@go.vn').role, 'ecom_exec');
  assert.equal(Number(rows.find((r) => r.email === 'staff1@go.vn').telegram_chat_id), chat.staff1);
  await assert.rejects(api(C.admin, { action: 'admin.invite', email: 'acc1@go.vn', full_name: 'x', role: 'account' }), /exists/);
  await assert.rejects(api(C.acc1, { action: 'admin.invite', email: 'z@go.vn', full_name: 'x', role: 'admin' }), /forbidden/);
  const calls = await tgCalls();
  assert.ok(msgTo(calls, chat.staff1).some((c) => /Đã liên kết/.test(c.body.text)));
});

test('health, server-side rule cases and Telegram webhook connection', async () => {
  const h = await api(C.admin, { action: 'system.health' });
  assert.equal(h.cases.filter((c) => !c.pass).length, 0);
  assert.equal(h.cronSecretConfigured, true);
  const con = await api(C.admin, { action: 'system.connect_telegram' });
  assert.match(con.url, /\/functions\/v1\/ops-hub\/telegram-webhook$/);
  const h2 = await api(C.admin, { action: 'system.health' });
  assert.equal(h2.telegram.webhookOk, true);
  assert.equal(h2.telegram.username, 'gomedia_local_bot');
  assert.equal(await webhook({ message: { chat: { id: 1, type: 'private' }, text: 'hi' } }, 'wrong'), 401);
  assert.equal((await cron('dispatch-checkpoints', vn(0, '09:00'), 'wrong')).status, 401);
});

let LIB;

test('PM builds the Pricing Library; accounts cannot', async () => {
  const items = [
    { name: 'Video TikTok', unit: 'video', service_group: 'Social Media', unit_price: 1_500_000 },
    { name: 'Bài Facebook', unit: 'bài', service_group: 'Social Media', unit_price: 600_000 },
    { name: 'Kế hoạch nội dung', unit: 'tháng', service_group: 'Social Media', unit_price: 2_000_000 },
  ];
  const { data, error } = await C.pm.from('library_items').insert(items).select('id, name, unit_price');
  assert.equal(error, null);
  LIB = Object.fromEntries(data.map((d) => [d.name, d]));
  const bad = await C.acc1.from('library_items').insert({ name: 'x', unit: 'x', service_group: 'x', unit_price: 1 });
  assert.ok(bad.error);
  const rules = await C.acc1.from('price_rules').select('level');
  assert.equal(rules.data.length, 0);
});

async function newQuote(client, discount, priceOverrides = {}) {
  const { data: q, error } = await client.from('quotes').insert({ client: 'Chuỗi F&B mẫu', requested_at: new Date(Date.now() - 3600e3).toISOString(), discount_pct: discount }).select('id, code, status').single();
  assert.equal(error, null);
  const lines = [
    ['Video TikTok', 12],
    ['Bài Facebook', 8],
    ['Kế hoạch nội dung', 3],
  ].map(([n, qty], i) => {
    const price = priceOverrides[n] ?? LIB[n].unit_price;
    return { quote_id: q.id, position: i + 1, library_item_id: LIB[n].id, item_name: n, unit: 'x', qty, unit_price: price, library_price: LIB[n].unit_price, override_reason: price !== LIB[n].unit_price ? 'Phạm vi đặc thù' : null };
  });
  const r = await client.from('quote_lines').insert(lines);
  assert.equal(r.error, null);
  return { ...q, lines };
}

test('UAT 1 · in-band quote is sent at once and joins the archive', async () => {
  const q = await newQuote(C.acc1, 5);
  const band = await api(C.acc1, { action: 'quote.band', lines: q.lines, discount_pct: 5 });
  assert.equal(band.band.level, 'send_now');
  assert.equal(band.full, undefined);
  await assert.rejects(api(C.acc1, { action: 'quote.submit', quote_id: q.id }), /bad_transition/);
  const sent = await api(C.acc1, { action: 'quote.send', quote_id: q.id });
  assert.equal(sent.quote.status, 'sent');
  assert.equal(Number(sent.quote.total), 27_360_000);
  assert.ok(sent.quote.sent_at);
  const seenByOther = await C.acc2.from('quotes').select('id').eq('id', q.id);
  assert.equal(seenByOther.data.length, 1);
});

test('UAT 2 · 15% discount goes to the PM queue only, PM gets a message, approves, account sends', async () => {
  await tgReset();
  const q = await newQuote(C.acc1, 15);
  const sub = await api(C.acc1, { action: 'quote.submit', quote_id: q.id }, vn(0, '09:00'));
  assert.equal(sub.quote.status, 'pending');
  assert.equal(sub.quote.approver, 'pm');
  const pmQueue = await C.pm.from('quotes').select('id').eq('status', 'pending').eq('approver', 'pm');
  assert.equal(pmQueue.data.length, 1);
  const ceoQueue = await C.ceo.from('quotes').select('id').eq('status', 'pending').eq('approver', 'ceo');
  assert.equal(ceoQueue.data.length, 0);
  assert.equal(msgTo(await tgCalls(), chat.pm).length, 1);
  await assert.rejects(api(C.ceo, { action: 'quote.decide', quote_id: q.id, decision: 'approve' }), /wrong_approver/);
  const ok = await api(C.pm, { action: 'quote.decide', quote_id: q.id, decision: 'approve', comment: 'OK' }, vn(0, '09:30'));
  assert.equal(ok.quote.status, 'approved');
  assert.ok(msgTo(await tgCalls(), chat.acc1).some((c) => /đã được duyệt/.test(c.body.text)));
  const sent = await api(C.acc1, { action: 'quote.send', quote_id: q.id });
  assert.equal(sent.quote.status, 'sent');
});

test('UAT 3 · one price +25% needs the CEO; the PM never sees it', async () => {
  const q = await newQuote(C.acc1, 5, { 'Video TikTok': 1_875_000 });
  const band = await api(C.acc1, { action: 'quote.band', lines: q.lines, discount_pct: 5 });
  assert.equal(band.band.level, 'ceo');
  assert.ok(!JSON.stringify(band).includes('limit'));
  const sub = await api(C.acc1, { action: 'quote.submit', quote_id: q.id });
  assert.equal(sub.quote.approver, 'ceo');
  const pmQueue = await C.pm.from('quotes').select('id').eq('status', 'pending').eq('approver', 'pm');
  assert.equal(pmQueue.data.length, 0);
  await assert.rejects(api(C.pm, { action: 'quote.decide', quote_id: q.id, decision: 'approve' }), /wrong_approver/);
  const ok = await api(C.ceo, { action: 'quote.decide', quote_id: q.id, decision: 'approve' });
  assert.equal(ok.quote.status, 'approved');
});

test('override without a reason is refused', async () => {
  const q = await newQuote(C.acc1, 0);
  await C.acc1.from('quote_lines').update({ unit_price: 1_600_000, override_reason: null }).eq('quote_id', q.id).eq('item_name', 'Video TikTok');
  await assert.rejects(api(C.acc1, { action: 'quote.send', quote_id: q.id }), /lý do/);
});

test('UAT 4 · changes requested: the account sees the comment and the quote returns to Draft on edit', async () => {
  const q = await newQuote(C.acc1, 15);
  await api(C.acc1, { action: 'quote.submit', quote_id: q.id });
  await assert.rejects(api(C.pm, { action: 'quote.decide', quote_id: q.id, decision: 'changes', comment: '' }), /comment_required/);
  const r = await api(C.pm, { action: 'quote.decide', quote_id: q.id, decision: 'changes', comment: 'Giảm chiết khấu về 10%' });
  assert.equal(r.quote.status, 'changes_requested');
  const { data: ap } = await C.acc1.from('approvals').select('decision, comment').eq('quote_id', q.id);
  assert.deepEqual(ap, [{ decision: 'changes', comment: 'Giảm chiết khấu về 10%' }]);
  const upd = await C.acc1.from('quotes').update({ discount_pct: 10, status: 'draft' }).eq('id', q.id).select('status, band_result, approver');
  assert.deepEqual(upd.data, [{ status: 'draft', band_result: null, approver: null }]);
  const sent = await api(C.acc1, { action: 'quote.send', quote_id: q.id });
  assert.equal(sent.quote.status, 'sent');
});

test('UAT 5 · editing an approved quote sends it back to Draft and needs approval again', async () => {
  const q = await newQuote(C.acc1, 15);
  await api(C.acc1, { action: 'quote.submit', quote_id: q.id });
  await api(C.pm, { action: 'quote.decide', quote_id: q.id, decision: 'approve' });
  const direct = await C.acc1.from('quote_lines').update({ qty: 99 }).eq('quote_id', q.id).select('id');
  assert.equal(direct.data.length, 0);
  const re = await api(C.acc1, { action: 'quote.reopen', quote_id: q.id });
  assert.equal(re.quote.status, 'draft');
  await assert.rejects(api(C.acc1, { action: 'quote.send', quote_id: q.id }), /bad_transition/);
});

let T1;
let T2;

test('tasks are created with 4 checkpoints by the executive only', async () => {
  await assert.rejects(api(C.acc1, { action: 'task.create', name: 'x' }), /forbidden/);
  const base = { milestones: ['Chốt brief', 'Bản nháp', 'Duyệt nội bộ', 'Đăng lên sàn'], priority_note: 'Ưu tiên banner chính' };
  T1 = (await api(C.exec, { action: 'task.create', name: 'Banner 11.11', owner_id: U.staff1, start_at: vn(0, '08:00'), due_at: vn(4, '17:30'), ...base })).task_id;
  T2 = (await api(C.exec, { action: 'task.create', name: 'SEO 20 trang', owner_id: U.staff2, start_at: vn(0, '08:00'), due_at: vn(4, '17:30'), ...base })).task_id;
  const cps = await sql(`select pct, scheduled_at from public.checkpoints where task_id = $1 order by pct`, [T1]);
  assert.deepEqual(cps.map((c) => new Date(c.scheduled_at).toISOString()), [vn(1, '10:00'), vn(2, '12:00'), vn(3, '15:30'), vn(4, '17:06')]);
  const staffView = await C.staff1.from('tasks').select('id');
  assert.equal(staffView.data.length, 1);
});

test('nothing is sent outside working hours', async () => {
  await tgReset();
  const r = await cron('dispatch-checkpoints', vn(1, '19:00'));
  assert.equal(r.status, 200);
  assert.equal(r.body.can_send, false);
  assert.equal(msgTo(await tgCalls(), chat.staff1).length, 0);
});

test('UAT 7 · owner answers On plan in Telegram; milestone 1 is marked done', async () => {
  await tgReset();
  const r = await cron('dispatch-checkpoints', vn(1, '10:15'));
  assert.equal(r.body.sent, 1);
  assert.equal(r.body.web_only, 1);
  const msg = msgTo(await tgCalls(), chat.staff1)[0];
  assert.match(msg.body.text, /Checkpoint 25%/);
  const cb = msg.body.reply_markup.inline_keyboard[0][0].callback_data;
  assert.ok(cb.length <= 64);
  await webhook({ callback_query: { id: 'q1', from: { id: chat.staff1 }, data: cb, message: { message_id: 5, chat: { id: chat.staff1, type: 'private' } } } });
  const [t] = await sql(`select status from public.tasks where id = $1`, [T1]);
  assert.equal(t.status, 'on_track');
  const ms = await C.staff1.from('milestones').select('idx, done_at').eq('task_id', T1).order('idx');
  assert.ok(ms.data[0].done_at);
  assert.equal(ms.data[1].done_at, null);
  // Same button again: refused, nothing changes.
  await webhook({ callback_query: { id: 'q2', from: { id: chat.staff1 }, data: cb, message: { message_id: 5, chat: { id: chat.staff1, type: 'private' } } } });
  const answered = (await tgCalls()).filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body.text);
  assert.ok(answered.some((t) => /đã được trả lời/.test(t)));
  // A stranger pressing the button is refused.
  await webhook({ callback_query: { id: 'q3', from: { id: chat.exec }, data: cb, message: { message_id: 5, chat: { id: chat.exec, type: 'private' } } } });
});

test('web check-in: blocked needs a reason; owners only answer their own checkpoints', async () => {
  const [cp] = await sql(`select id from public.checkpoints where task_id = $1 and pct = 25`, [T2]);
  await assert.rejects(api(C.staff1, { action: 'checkin.answer', checkpoint_id: cp.id, answer: 'on_plan' }, vn(1, '11:00')), /not_owner|Chỉ người/);
  await assert.rejects(api(C.staff2, { action: 'checkin.answer', checkpoint_id: cp.id, answer: 'blocked', reason: ' ' }, vn(1, '11:00')), /lý do/);
});

test('UAT 10 · silent owner: a No reply alert after 2 working hours', async () => {
  // T2's 25% checkpoint was put on the web (staff2 has no Telegram) on Tue 10:15 and never answered.
  const early = await cron('dispatch-checkpoints', vn(1, '12:00'));
  assert.equal(early.body.no_reply, 0);
  await tgReset();
  const late = await cron('dispatch-checkpoints', vn(1, '13:46'));
  assert.equal(late.body.no_reply, 1);
  const [t] = await sql(`select status from public.tasks where id = $1`, [T2]);
  assert.equal(t.status, 'no_update');
  assert.ok(msgTo(await tgCalls(), chat.exec).some((c) => /KHÔNG TRẢ LỜI/.test(c.body.text)));
  const again = await cron('dispatch-checkpoints', vn(1, '15:00'));
  assert.equal(again.body.no_reply, 0);
});

test('UAT 8 · Behind raises an At risk alert with done, pending and priority to the executive', async () => {
  await tgReset();
  await cron('dispatch-checkpoints', vn(2, '12:00'));
  const msg = msgTo(await tgCalls(), chat.staff1).find((c) => /Checkpoint 50%/.test(c.body.text));
  const cb = msg.body.reply_markup.inline_keyboard[1][0].callback_data;
  assert.match(cb, /:b$/);
  await webhook({ callback_query: { id: 'q4', from: { id: chat.staff1 }, data: cb, message: { message_id: 6, chat: { id: chat.staff1, type: 'private' } } } });
  const [t] = await sql(`select status from public.tasks where id = $1`, [T1]);
  assert.equal(t.status, 'at_risk');
  const alerts = await C.exec.from('alerts').select('kind').eq('task_id', T1);
  assert.deepEqual(alerts.data.map((a) => a.kind), ['at_risk']);
  const toExec = msgTo(await tgCalls(), chat.exec).map((c) => c.body.text).join('\n');
  assert.match(toExec, /CÓ RỦI RO/);
  assert.match(toExec, /Đã xong: Chốt brief/);
  assert.match(toExec, /Đang chờ: Bản nháp/);
  assert.match(toExec, /Ưu tiên: Ưu tiên banner chính/);
});

test('UAT 9 · a blocker reported between checkpoints alerts the executive at once, with the reason', async () => {
  await tgReset();
  await webhook({ message: { message_id: 10, chat: { id: chat.staff1, type: 'private' }, text: '/baochan' } });
  const list = msgTo(await tgCalls(), chat.staff1).find((c) => c.body.reply_markup?.inline_keyboard);
  const cb = list.body.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(cb, `k:${T1}`);
  await webhook({ callback_query: { id: 'q5', from: { id: chat.staff1 }, data: cb, message: { message_id: 11, chat: { id: chat.staff1, type: 'private' } } } });
  await webhook({ message: { message_id: 12, chat: { id: chat.staff1, type: 'private' }, text: 'Khách chưa gửi ảnh sản phẩm' } });
  const [t] = await sql(`select status from public.tasks where id = $1`, [T1]);
  assert.equal(t.status, 'blocked');
  const alerts = await C.exec.from('alerts').select('kind, reason').eq('task_id', T1).order('created_at');
  assert.deepEqual(alerts.data.at(-1), { kind: 'blocker', reason: 'Khách chưa gửi ảnh sản phẩm' });
  assert.ok(msgTo(await tgCalls(), chat.exec).some((c) => /BỊ CHẶN/.test(c.body.text) && /Khách chưa gửi ảnh/.test(c.body.text)));
});

test('web answer with evidence link updates the task; the executive acknowledges alerts', async () => {
  await cron('dispatch-checkpoints', vn(2, '12:00'));
  const { data: open } = await C.staff2.from('checkpoints').select('id, pct, sent_at, answered_at, expired_at').eq('task_id', T2).order('pct');
  const live = open.find((c) => c.sent_at && !c.answered_at && !c.expired_at);
  assert.equal(live.pct, 50);
  assert.ok(open.find((c) => c.pct === 25).expired_at);
  const r = await api(C.staff2, { action: 'checkin.answer', checkpoint_id: live.id, answer: 'on_plan', evidence_url: 'https://drive.example/seo' }, vn(2, '12:30'));
  assert.equal(r.status, 'on_track');
  assert.equal(r.doneCount, 2);
  await assert.rejects(api(C.staff2, { action: 'checkin.answer', checkpoint_id: live.id, answer: 'on_plan' }), /already_answered|đã được trả lời/);
  const { data: alert } = await C.exec.from('alerts').select('id').eq('task_id', T2).limit(1).single();
  const ack = await C.exec.from('alerts').update({ acknowledged_by: U.exec, note: 'Đã nhắc' }).eq('id', alert.id).select('acknowledged_at');
  assert.ok(ack.data[0].acknowledged_at);
});

test('close at the deadline: on time only with 4/4; overdue notes the earlier warning', async () => {
  for (const [d, hm] of [
    [3, '15:30'],
    [4, '17:06'],
  ]) {
    await cron('dispatch-checkpoints', vn(d, hm));
    const { data } = await C.staff2.from('checkpoints').select('id, sent_at, answered_at, expired_at').eq('task_id', T2).order('pct');
    const live = data.find((c) => c.sent_at && !c.answered_at && !c.expired_at);
    await api(C.staff2, { action: 'checkin.answer', checkpoint_id: live.id, answer: 'on_plan' });
  }
  const before = await cron('close-tasks', vn(4, '17:00'));
  assert.equal(before.body.closed, 0);
  const r = await cron('close-tasks', vn(4, '17:45'));
  assert.equal(r.body.closed, 2);
  const rows = await sql(`select id, status, closed_as from public.tasks order by name`);
  assert.deepEqual(rows.map((x) => [x.status, x.closed_as]).sort(), [['done', 'on_time'], ['overdue', 'overdue']].sort());
  const [ov] = await sql(`select reason from public.alerts where task_id = $1 and kind = 'overdue'`, [T1]);
  assert.match(ov.reason, /Đã có cảnh báo trước deadline/);
});

test('cancel and plan edits follow their limits', async () => {
  const t = await api(C.exec, { action: 'task.create', name: 'Livestream', owner_id: U.staff1, start_at: vn(7, '08:00'), due_at: vn(8, '17:30'), milestones: ['a', 'b', 'c', 'd'] });
  const upd = await api(C.exec, { action: 'task.update', task_id: t.task_id, name: 'Livestream 2h', owner_id: U.staff1, start_at: vn(7, '08:00'), due_at: vn(9, '17:30'), milestones: ['a', 'b', 'c', 'd2'] });
  assert.equal(upd.checkpoints.length, 4);
  await assert.rejects(api(C.exec, { action: 'task.cancel', task_id: t.task_id, reason: '' }), /reason_required/);
  await api(C.exec, { action: 'task.cancel', task_id: t.task_id, reason: 'Khách huỷ' });
  const [row] = await sql(`select status from public.tasks where id = $1`, [t.task_id]);
  assert.equal(row.status, 'cancelled');
});

test('CSV imports: quote history and tasks, with a dry run first', async () => {
  const rows = [];
  for (let i = 1; i <= 3; i++) {
    for (const [item, qty] of [
      ['Video TikTok', 6],
      ['Bài Facebook', 4],
    ]) {
      rows.push({ quote_code: `H-${i}`, client_alias: `Khách ${i}`, service_group: 'Social Media', requested_at: '06/07/2026 09:00', sent_at: '06/07/2026 15:30', item_name: item, unit: '', qty: String(qty), unit_price: '1.500.000', discount_pct: '5' });
    }
  }
  rows.push({ quote_code: 'H-bad', client_alias: 'x', requested_at: '06/07/2026 09:00', sent_at: '05/07/2026 09:00', item_name: 'Video TikTok', qty: '1', unit_price: '1' });
  const dry = await api(C.pm, { action: 'quote.import', rows, dryRun: true });
  assert.equal(dry.preview.quotes, 3);
  assert.equal(dry.preview.errors.length, 1);
  const real = await api(C.pm, { action: 'quote.import', rows });
  assert.equal(real.result.inserted, 3);
  const again = await api(C.pm, { action: 'quote.import', rows });
  assert.equal(again.result.skipped.length, 3);
  const tasks = await api(C.exec, {
    action: 'task.import',
    rows: [
      { task_name: 'Video unbox', owner_email: 'staff1@go.vn', task_type: 'Video sản phẩm', start_at: '01/12/2026 08:00', due_at: '04/12/2026 17:30' },
      { task_name: 'Ai đó', owner_email: 'nobody@go.vn', task_type: 'Video sản phẩm', start_at: '01/12/2026 08:00', due_at: '04/12/2026 17:30' },
      { task_name: 'Task đã quá hạn trong sheet cũ', owner_email: 'staff1@go.vn', task_type: 'Video sản phẩm', start_at: '01/10/2026 08:00', due_at: '02/10/2026 17:30' },
    ],
  });
  assert.equal(tasks.created, 1);
  assert.equal(tasks.preview.errors[0].row, 2);
  assert.equal(tasks.preview.errors[1].row, 3);
  assert.match(tasks.preview.errors[1].message, /Deadline đã qua/);
});

test('demo seed builds a complete synthetic workspace', async () => {
  const r = await api(C.admin, { action: 'demo.seed' });
  assert.equal(r.baselineQuotes, 19);
  assert.ok(r.tasks >= 7);
  const [{ n }] = await sql(`select count(*)::int n from public.quotes where code like 'DEMO-H-%'`);
  assert.equal(n, 19);
  const cleared = await api(C.admin, { action: 'demo.clear' });
  assert.equal(cleared.removedUsers, 6);
});
