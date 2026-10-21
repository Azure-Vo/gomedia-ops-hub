// Row Level Security and SQL-function tests against a real Postgres with the Supabase stub.
// Run: node --test tools/local-stack/rls.test.mjs  (Postgres on 127.0.0.1:54322)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const pool = new pg.Pool({ host: '127.0.0.1', port: Number(process.env.PGPORT || 54322), user: 'postgres', database: process.env.PGDATABASE || 'postgres' });
const U = {};

async function sql(text, params = []) {
  return (await pool.query(text, params)).rows;
}

/** Runs fn inside a transaction as the given user (or anon), rolled back unless keep=true. */
async function as(uid, fn, { keep = false, role = uid ? 'authenticated' : 'anon' } = {}) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role } : { role })]);
    const out = await fn({ q: async (t, p = []) => (await c.query(t, p)).rows });
    await c.query(keep ? 'commit' : 'rollback');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

async function denied(promise, pattern = /permission denied|row-level security|violates/) {
  await assert.rejects(promise, (e) => pattern.test(e.message));
}

before(async () => {
  await sql(`truncate public.events, public.alerts, public.checkpoints, public.milestones, public.tasks, public.approvals,
             public.quote_lines, public.quotes, public.library_items restart identity cascade`);
  await sql(`delete from public.profiles`).catch(() => {});
  await sql(`alter table public.profiles disable trigger protect_last_admin`);
  await sql(`delete from auth.users`);
  await sql(`alter table public.profiles enable trigger protect_last_admin`);
  for (const [key, role] of Object.entries({ admin: 'admin', acc1: 'account', acc2: 'account', pm: 'pm', ceo: 'ceo', exec: 'ecom_exec', staff1: 'staff', staff2: 'staff' })) {
    const [row] = await sql(
      `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ($1, $2, $3) returning id`,
      [`${key}@test.vn`, JSON.stringify({ ops_role: role }), JSON.stringify({ full_name: key.toUpperCase() })],
    );
    U[key] = row.id;
  }
});

after(async () => pool.end());

test('profiles are created from auth users with the server-set role', async () => {
  const rows = await sql(`select email, role, full_name from public.profiles order by email`);
  assert.equal(rows.length, 8);
  assert.equal(rows.find((r) => r.email === 'acc1@test.vn').role, 'account');
  assert.equal(rows.find((r) => r.email === 'pm@test.vn').full_name, 'PM');
});

test('anon sees nothing', async () => {
  await denied(as(null, ({ q }) => q(`select id from public.profiles`)));
  await denied(as(null, ({ q }) => q(`select id from public.library_items`)));
});

test('an account not created by the app (public sign-up, dashboard) starts inactive and sees nothing', async () => {
  const [row] = await sql(`insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ('outsider@example.com', '{}', '{}') returning id`);
  try {
    const [p] = await sql(`select role, active from public.profiles where id = $1`, [row.id]);
    assert.deepEqual(p, { role: 'staff', active: false });
    const own = await as(row.id, ({ q }) => q(`select id, active from public.profiles`));
    assert.deepEqual(own.map((r) => r.id), [row.id]); // only its own profile, so the app can say "not activated"
    for (const table of ['library_items', 'settings', 'task_types', 'quotes', 'tasks', 'price_rules']) {
      const rows = await as(row.id, ({ q }) => q(`select 1 from public.${table}`));
      assert.equal(rows.length, 0, `${table} visible to an inactive account`);
    }
  } finally {
    await sql(`delete from auth.users where id = $1`, [row.id]);
  }
});

test('telegram fields and checkpoint tokens are hidden from the browser', async () => {
  const names = await as(U.acc1, ({ q }) => q(`select id, full_name, role from public.profiles`));
  assert.equal(names.length, 8);
  await denied(as(U.acc1, ({ q }) => q(`select telegram_chat_id from public.profiles`)));
  await denied(as(U.staff1, ({ q }) => q(`select token from public.checkpoints`)));
  await denied(as(U.staff1, ({ q }) => q(`select * from public.checkpoints`)));
});

test('a user cannot raise their own role; the admin can change roles', async () => {
  const r = await as(U.acc1, ({ q }) => q(`update public.profiles set full_name = 'Tên mới' where id = $1 returning full_name`, [U.acc1]));
  assert.equal(r[0].full_name, 'Tên mới');
  await denied(as(U.acc1, ({ q }) => q(`update public.profiles set role = 'admin' where id = $1`, [U.acc1])));
  const other = await as(U.acc1, ({ q }) => q(`update public.profiles set full_name = 'x' where id = $1 returning id`, [U.acc2]));
  assert.equal(other.length, 0);
  const byAdmin = await as(U.admin, ({ q }) => q(`update public.profiles set role = 'pm' where id = $1 returning role`, [U.staff2]));
  assert.equal(byAdmin[0].role, 'pm');
});

test('the last admin cannot be removed', async () => {
  await assert.rejects(as(U.admin, ({ q }) => q(`update public.profiles set role = 'account' where id = $1`, [U.admin])), /admin cuối cùng/);
  await assert.rejects(sql(`delete from auth.users where id = $1`, [U.admin]), /admin cuối cùng/);
});

test('only PM, CEO and admin edit the Pricing Library; changes are audited', async () => {
  await denied(as(U.acc1, ({ q }) => q(`insert into public.library_items (name, unit, service_group, unit_price) values ('X','x','g',1)`)));
  const [item] = await as(U.pm, ({ q }) => q(`insert into public.library_items (name, unit, service_group, unit_price) values ('TikTok video','video','Social Media',1500000) returning id, updated_by`), { keep: true });
  assert.equal(item.updated_by, U.pm);
  const none = await as(U.acc1, ({ q }) => q(`update public.library_items set unit_price = 1 where id = $1 returning id`, [item.id]));
  assert.equal(none.length, 0);
  await as(U.ceo, ({ q }) => q(`update public.library_items set unit_price = 1600000 where id = $1`, [item.id]), { keep: true });
  const ev = await sql(`select actor, action, payload from public.events where entity = 'library_items' and action = 'update'`);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].actor, U.ceo);
  assert.deepEqual(ev[0].payload.unit_price, [1500000, 1600000]);
  U.item = item.id;
});

test('price rules (margin floor) are visible to the CEO only', async () => {
  assert.equal((await as(U.acc1, ({ q }) => q(`select level from public.price_rules`))).length, 0);
  assert.equal((await as(U.pm, ({ q }) => q(`select level from public.price_rules`))).length, 0);
  assert.equal((await as(U.ceo, ({ q }) => q(`select level from public.price_rules`))).length, 3);
  const upd = await as(U.ceo, ({ q }) => q(`update public.price_rules set margin_floor_pct = 80 where level = 'send_now' returning margin_floor_pct`));
  assert.equal(Number(upd[0].margin_floor_pct), 80);
  assert.equal((await as(U.pm, ({ q }) => q(`update public.price_rules set max_discount_pct = 50 returning level`))).length, 0);
});

test('accounts create quotes; codes are generated; status cannot be forged', async () => {
  const [q1] = await as(U.acc1, ({ q }) => q(`insert into public.quotes (client, requested_at) values ('Khách A', now() - interval '1 hour') returning id, code, status, created_by`), { keep: true });
  assert.match(q1.code, /^Q-\d{4}-\d{3}$/);
  assert.equal(q1.status, 'draft');
  assert.equal(q1.created_by, U.acc1);
  await denied(as(U.acc1, ({ q }) => q(`insert into public.quotes (client, status) values ('x','sent')`)));
  await denied(as(U.acc1, ({ q }) => q(`update public.quotes set status = 'pending' where id = $1`, [q1.id])));
  await denied(as(U.acc1, ({ q }) => q(`update public.quotes set sent_at = now() where id = $1`, [q1.id])));
  await denied(as(U.pm, ({ q }) => q(`insert into public.quotes (client) values ('PM quote')`)));
  U.q1 = q1.id;
});

test('accounts see their own quotes and every sent quote (the archive)', async () => {
  assert.equal((await as(U.acc2, ({ q }) => q(`select id from public.quotes where id = $1`, [U.q1]))).length, 0);
  assert.equal((await as(U.pm, ({ q }) => q(`select id from public.quotes where id = $1`, [U.q1]))).length, 1);
  assert.equal((await as(U.staff1, ({ q }) => q(`select id from public.quotes`))).length, 0);
  await sql(`update public.quotes set status = 'sent', sent_at = now() where id = $1`, [U.q1]);
  assert.equal((await as(U.acc2, ({ q }) => q(`select id from public.quotes where id = $1`, [U.q1]))).length, 1);
  await sql(`update public.quotes set status = 'draft', sent_at = null where id = $1`, [U.q1]);
});

test('lines can be edited only while the quote is Draft or Changes requested', async () => {
  await as(U.acc1, ({ q }) => q(`insert into public.quote_lines (quote_id, library_item_id, item_name, unit, qty, unit_price, library_price) values ($1, $2, 'TikTok video', 'video', 12, 1600000, 1600000)`, [U.q1, U.item]), { keep: true });
  await denied(as(U.acc2, ({ q }) => q(`insert into public.quote_lines (quote_id, item_name, qty, unit_price) values ($1, 'x', 1, 1)`, [U.q1])));
  await sql(`update public.quotes set status = 'pending', band_result = 'pm', approver = 'pm' where id = $1`, [U.q1]);
  await denied(as(U.acc1, ({ q }) => q(`insert into public.quote_lines (quote_id, item_name, qty, unit_price) values ($1, 'x', 1, 1)`, [U.q1])));
  assert.equal((await as(U.acc1, ({ q }) => q(`update public.quotes set client = 'y', status = 'draft' where id = $1 returning id`, [U.q1]))).length, 0);
  assert.equal((await as(U.acc1, ({ q }) => q(`update public.quote_lines set qty = 1 where quote_id = $1 returning id`, [U.q1]))).length, 0);
  // Changes requested → editing a line puts the quote back to Draft and clears the band result.
  await sql(`update public.quotes set status = 'changes_requested' where id = $1`, [U.q1]);
  await as(U.acc1, ({ q }) => q(`update public.quote_lines set qty = 10 where quote_id = $1`, [U.q1]), { keep: true });
  const [after] = await sql(`select status, band_result, approver from public.quotes where id = $1`, [U.q1]);
  assert.deepEqual(after, { status: 'draft', band_result: null, approver: null });
});

test('tasks: staff see only their own; the executive sees and acknowledges alerts', async () => {
  const [t1] = await sql(`select public.ops_create_task($1::jsonb) as id`, [JSON.stringify({
    name: 'Banner 11.11', owner_id: U.staff1, start_at: '2026-10-05T01:00:00Z', due_at: '2026-10-09T10:30:00Z', actor: U.exec,
    milestones: ['a', 'b', 'c', 'd'],
    checkpoints: [25, 50, 75, 99].map((pct, i) => ({ pct, scheduled_at: `2026-10-0${6 + i}T03:00:00Z`, token: `tok${pct}` })),
  })]);
  U.t1 = t1.id;
  assert.equal((await as(U.staff1, ({ q }) => q(`select id from public.tasks`))).length, 1);
  assert.equal((await as(U.staff2, ({ q }) => q(`select id from public.tasks`))).length, 0);
  assert.equal((await as(U.staff1, ({ q }) => q(`select id, pct from public.checkpoints`))).length, 4);
  assert.equal((await as(U.staff2, ({ q }) => q(`select id from public.milestones`))).length, 0);
  assert.equal((await as(U.exec, ({ q }) => q(`select id from public.tasks`))).length, 1);
  assert.equal((await as(U.staff1, ({ q }) => q(`update public.tasks set name = 'x' returning id`))).length, 0);
  await denied(as(U.exec, ({ q }) => q(`update public.tasks set status = 'done'`)));
  await denied(as(U.exec, ({ q }) => q(`select public.ops_create_task('{}'::jsonb)`)));

  const [a] = await sql(`insert into public.alerts (task_id, kind, reason) values ($1, 'blocker', 'Chưa có ảnh') returning id`, [U.t1]);
  assert.equal((await as(U.staff1, ({ q }) => q(`select id from public.alerts`))).length, 0);
  const ack = await as(U.exec, ({ q }) => q(`update public.alerts set acknowledged_by = $2, acknowledged_at = '2000-01-01', note = 'Đã gọi khách' where id = $1 returning acknowledged_at`, [a.id, U.exec]), { keep: true });
  assert.ok(new Date(ack[0].acknowledged_at).getFullYear() >= 2026);
  await assert.rejects(as(U.exec, ({ q }) => q(`update public.alerts set acknowledged_by = $2 where id = $1`, [a.id, U.admin])));
});

test('answers are applied atomically and refuse stale state', async () => {
  const [cp] = await sql(`select id from public.checkpoints where task_id = $1 and pct = 25`, [U.t1]);
  await sql(`update public.checkpoints set sent_at = now() where id = $1`, [cp.id]);
  const payload = (expectedDone, status) => JSON.stringify({
    task_id: U.t1, checkpoint_id: cp.id, expected_done: expectedDone, expected_status: status, answer: 'on_plan', via: 'web', actor: U.staff1,
    milestone_idx: 1, evidence_url: 'https://drive.example/x',
    effect: { doneCount: 1, status: 'on_track', markDone: [1], alert: null },
  });
  await assert.rejects(sql(`select public.ops_apply_answer($1::jsonb)`, [payload(2, 'not_started')]), /conflict/);
  const [r] = await sql(`select public.ops_apply_answer($1::jsonb) as r`, [payload(0, 'not_started')]);
  assert.equal(r.r.status, 'on_track');
  await assert.rejects(sql(`select public.ops_apply_answer($1::jsonb)`, [payload(1, 'on_track')]), /already_answered/);
  const [m] = await sql(`select done_at is not null as done, evidence_url from public.milestones where task_id = $1 and idx = 1`, [U.t1]);
  assert.deepEqual(m, { done: true, evidence_url: 'https://drive.example/x' });
  const [close] = await sql(`select public.ops_close_task($1::jsonb) as r`, [JSON.stringify({ task_id: U.t1, closed_as: 'overdue', status: 'overdue', reason: 'Trễ, đã được cảnh báo trước' })]);
  assert.ok(close.r.alert_id);
  const [t] = await sql(`select status, closed_as from public.tasks where id = $1`, [U.t1]);
  assert.deepEqual(t, { status: 'overdue', closed_as: 'overdue' });
  const open = await sql(`select count(*)::int as n from public.checkpoints where task_id = $1 and answered_at is null and expired_at is null`, [U.t1]);
  assert.equal(open[0].n, 0);
});

test('the audit log is append-only, readable by admin and CEO', async () => {
  assert.equal((await as(U.acc1, ({ q }) => q(`select id from public.events`))).length, 0);
  assert.ok((await as(U.admin, ({ q }) => q(`select id from public.events`))).length > 0);
  await denied(as(U.admin, ({ q }) => q(`update public.events set action = 'x'`)));
  await denied(as(U.admin, ({ q }) => q(`delete from public.events`)));
  await denied(as(null, ({ q }) => q(`delete from public.events`), { role: 'service_role' }));
  await as(U.acc1, ({ q }) => q(`insert into public.events (entity, action) values ('ui', 'pdf.downloaded')`), { keep: true });
  const [ins] = await sql(`select actor from public.events where action = 'pdf.downloaded'`);
  assert.equal(ins.actor, U.acc1);
  // Reading back the row (RETURNING) is refused: only admin and CEO read the log.
  await denied(as(U.acc1, ({ q }) => q(`insert into public.events (entity, action) values ('ui', 'x') returning id`)));
});

test('settings: everyone reads, only admin writes', async () => {
  assert.equal((await as(U.staff1, ({ q }) => q(`select timezone from public.settings`))).length, 1);
  assert.equal((await as(U.acc1, ({ q }) => q(`update public.settings set no_reply_window_hours = 5 returning id`))).length, 0);
  const r = await as(U.admin, ({ q }) => q(`update public.settings set no_reply_window_hours = 3 returning no_reply_window_hours, updated_by`));
  assert.equal(Number(r[0].no_reply_window_hours), 3);
  assert.equal(r[0].updated_by, U.admin);
});

test('telegram link codes and admin directory', async () => {
  const code = await as(U.staff1, ({ q }) => q(`select public.new_telegram_link_code() as c`), { keep: true });
  assert.match(code[0].c.code, /^[0-9A-F]{10}$/);
  const mine = await as(U.staff1, ({ q }) => q(`select public.my_telegram() as t`));
  assert.equal(mine[0].t.linked, false);
  assert.equal(mine[0].t.code, code[0].c.code);
  await denied(as(U.acc1, ({ q }) => q(`select * from public.admin_users()`)), /admin_only/);
  assert.equal((await as(U.admin, ({ q }) => q(`select * from public.admin_users()`))).length, 8);
  await denied(as(U.staff1, ({ q }) => q(`select * from public.task_owners()`)), /not_allowed/);
  assert.equal((await as(U.exec, ({ q }) => q(`select * from public.task_owners()`))).length, 8);
});

test('quote transitions check the expected status and record approvals', async () => {
  const tr = (expected, next, extra = {}) => sql(`select public.ops_quote_transition($1::jsonb) as q`, [JSON.stringify({ quote_id: U.q1, expected_status: expected, new_status: next, actor: U.acc1, event_action: 'test', ...extra })]);
  await assert.rejects(tr('pending', 'approved'), /conflict/);
  await tr('draft', 'pending', { fields: { band_result: 'pm', approver: 'pm', approval_requested: true } });
  await tr('pending', 'approved', { approval: { level: 'pm', approver_id: U.pm, decision: 'approve', comment: 'OK' } });
  const [sent] = await tr('approved', 'sent', { fields: { subtotal: 19200000, total: 19200000 } });
  assert.equal(sent.q.status, 'sent');
  assert.ok(sent.q.sent_at);
  assert.equal((await sql(`select count(*)::int n from public.approvals where quote_id = $1`, [U.q1]))[0].n, 1);
});
