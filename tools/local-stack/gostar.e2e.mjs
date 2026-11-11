// Browser run of Go Star (1.4) against the local stack (server.mjs running, users from e2e.mjs).
// Usage: node tools/local-stack/gostar.e2e.mjs <screenshot-dir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const API = 'http://127.0.0.1:54321';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:54340';
const SHOTS = process.argv[2] ?? './gostar-shots';
mkdirSync(SHOTS, { recursive: true });
const sql = async (q, p = []) => {
  const r = await (await fetch(`${API}/__test/sql`, { method: 'POST', body: JSON.stringify({ sql: q, params: p }) })).json();
  if (r.error) throw new Error(r.error);
  return r.rows;
};
let fails = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    fails++;
    console.log(`FAIL  ${name}\n      ${e.message.split('\n').slice(0, 3).join(' | ')}`);
  }
};

// ---- data: 4 staff, Lark sub-tasks in Oct and Nov 2026 (today is 2026-11-11 on this machine)
await sql(`delete from public.gostar_months; delete from public.gostar_scores; delete from public.lark_tasks; delete from public.lark_people`);
for (const [k, name] of [['s1', 'Trịnh Gia Huy'], ['s2', 'Nguyễn Bảo Ngọc'], ['s3', 'Phan Mỹ Duyên'], ['s4', 'Lương Tuấn Kiệt']]) {
  await sql(`insert into auth.users (email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values ($1, '{"ops_role":"staff"}', $2, now()) on conflict (email) do nothing`, [`${k}@go.vn`, JSON.stringify({ full_name: name })]);
}
const ids = Object.fromEntries((await sql(`select split_part(email, '@', 1) k, id, full_name from public.profiles`)).map((r) => [r.k, r]));
for (const k of ['s1', 's2', 's3', 's4', 'staff']) await sql(`insert into public.lark_people (open_id, name, profile_id) values ($1, $2, $3)`, [`sim:${ids[k].id}`, ids[k].full_name, ids[k].id]);
const parent = (await sql(`insert into public.lark_tasks (kind, code, name, due_date, mode) values ('parent', 'DA061', 'Shop DA061', '2026-11-30', 'simulation') returning id`))[0].id;
let n = 0;
const task = (k, due, done) =>
  sql(
    `insert into public.lark_tasks (kind, parent_id, code, parent_code, name, assignee_open_id, assignee_name, due_date, mode, completed_at, closed_at)
     values ('child', $1, $2, 'DA061', 'Việc', $3, $4, $5, 'simulation', $6, $6)`,
    [parent, `DA061-01-S${String(++n).padStart(2, '0')}`, `sim:${ids[k].id}`, ids[k].full_name, due, done ? `${done}T10:00:00+07:00` : null],
  );
await task('s1', '2026-10-20', '2026-10-19');
await task('s2', '2026-10-21', '2026-10-21');
await task('s3', '2026-10-22', '2026-10-24'); // late
await task('s4', '2026-10-23', null); // overdue
await task('s1', '2026-11-03', '2026-11-03');
await task('s2', '2026-11-05', '2026-11-04');
await task('s3', '2026-11-06', null); // overdue
await task('s4', '2026-11-25', null); // not due yet
const pm = ids.pm.id, exec = ids.exec.id;
const score = (m, k, kpi, q, t, by) => sql(`insert into public.gostar_scores (month, open_id, kpi_name, kpi_pct, quality, teamwork, updated_by) values ($1, $2, 'KPI tháng', $3, $4, $5, $6)`, [m, `sim:${ids[k].id}`, kpi, q, t, by]);
await score('2026-10', 's1', 104, 4, 5, pm);
await score('2026-10', 's2', 110, 5, 4, pm);
await score('2026-10', 's3', 100, 4, 4, exec);
await score('2026-10', 's4', 120, 5, 5, exec);

const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {});
async function login(key) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${key} pageerror] ${e.message}`));
  await page.goto(WEB);
  await page.getByLabel('Email').fill(`${key}@go.vn`);
  await page.getByRole('button', { name: 'Gửi email đăng nhập' }).click();
  await page.getByText('Kiểm tra hộp thư').waitFor();
  const { code } = await (await fetch(`${API}/__test/otp?email=${key}@go.vn`)).json();
  await page.getByLabel('Mã trong email').fill(code);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).waitFor({ timeout: 15000 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const rowText = async (page) => (await page.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));

await step('Menu: Go Star under S1; October ranking with tie-break and prizes', async () => {
  const p = await login('pm');
  await p.getByRole('link', { name: 'Go Star · Ghi nhận' }).click();
  await p.getByText('Đang tạm tính').waitFor();
  await p.getByLabel('Chọn tháng').selectOption('2026-10');
  await p.getByText('Tháng 10/2026 đã kết thúc, chưa chấm').or(p.getByText('Tháng 10/2026 đã kết thúc, chưa chốt')).waitFor();
  const rows = await rowText(p);
  // Huy 5★ KPI 104, Ngọc 5★ KPI 110 → Ngọc 1st on KPI; Kiệt 3★ (overdue task); Duyên 4★ (late task)
  assert.match(rows[0], /Nguyễn Bảo Ngọc/);
  assert.match(rows[0], /1\.000\.000/);
  assert.match(rows[1], /Trịnh Gia Huy/);
  assert.match(rows[1], /500\.000/);
  assert.match(rows[2], /Phan Mỹ Duyên/);
  assert.match(rows[2], /200\.000/);
  assert.match(rows[3], /Lương Tuấn Kiệt/);
  await p.getByText('Dự kiến Employee of the Month').first().waitFor();
  await shot(p, '1-pm-october');
  // PM cannot close a month
  assert.equal(await p.getByRole('button', { name: 'Chốt tháng' }).count(), 0);
  globalThis.pmPage = p;
});

await step('PM scores a person in November; stars update from Lark + scores', async () => {
  const p = globalThis.pmPage;
  await p.getByLabel('Chọn tháng').selectOption('2026-11');
  const row = p.locator('tbody tr', { hasText: 'Trịnh Gia Huy' });
  await row.getByRole('button', { name: 'Chấm điểm' }).click();
  await p.getByLabel('KPI cá nhân của tháng').fill('12 video TikTok shop');
  await p.getByLabel('% KPI đạt được').fill('101');
  await p.getByLabel('Work Quality (chất lượng đầu ra)').selectOption('5');
  await p.getByLabel('Teamwork (hỗ trợ, phối hợp)').selectOption('4');
  await shot(p, '2-pm-score-modal');
  await p.getByRole('button', { name: 'Lưu điểm' }).click();
  await p.getByText('Đã lưu điểm của Trịnh Gia Huy.').waitFor();
  await p.locator('tbody tr', { hasText: 'Trịnh Gia Huy' }).getByRole('button', { name: 'Sửa điểm' }).waitFor();
  const r = (await rowText(p)).find((t) => t.includes('Trịnh Gia Huy'));
  assert.match(r, /12 video TikTok shop/);
  assert.match(r, /1\/1 task con đã xong/);
  const saved = await sql(`select kpi_pct, quality, teamwork, updated_by from public.gostar_scores where month = '2026-11' and open_id = $1`, [`sim:${ids.s1.id}`]);
  assert.deepEqual(saved.map((x) => [Number(x.kpi_pct), x.quality, x.teamwork, x.updated_by]), [[101, 5, 4, pm]]);
  // November is still running: nobody can close it
  await shot(p, '3-pm-november');
});

await step('Staff sees the board (own row marked) but cannot score', async () => {
  const s = await login('s3');
  await s.goto(`${WEB}/gostar`);
  await s.getByText('Đang tạm tính').waitFor();
  assert.equal(await s.getByRole('button', { name: 'Chấm điểm' }).count(), 0);
  await s.getByText('(bạn)').waitFor();
  await shot(s, '4-staff-november');
});

await step('CEO closes October: frozen in gostar_months, scores locked, Lark card preview', async () => {
  const c = await login('ceo');
  await c.goto(`${WEB}/gostar`);
  await c.getByText('Đang tạm tính').waitFor();
  assert.ok(await c.getByRole('button', { name: 'Chốt tháng' }).isDisabled(), 'running month cannot be closed');
  await c.getByLabel('Chọn tháng').selectOption('2026-10');
  c.once('dialog', (d) => d.accept());
  await c.getByRole('button', { name: 'Chốt tháng' }).click();
  await c.getByText('Đã chốt Tháng 10/2026', { exact: false }).first().waitFor();
  const m = await sql(`select result->'rows'->0->>'name' n, (result->'rows'->0->>'prize')::int p from public.gostar_months where month = '2026-10'`);
  assert.deepEqual(m, [{ n: 'Nguyễn Bảo Ngọc', p: 1000000 }]);
  assert.equal(await c.getByRole('button', { name: 'Sửa điểm' }).count(), 0);
  await c.getByText('Go Star Tháng 10/2026 – Vinh danh nhân viên').waitFor();
  await shot(c, '5-ceo-october-closed');
});

await step('After closing, a PM write to October is refused by the database', async () => {
  const p = globalThis.pmPage;
  const r = await p.evaluate(async (openId) => {
    const cfg = window.OPS_HUB_CONFIG;
    const key = `ops-hub-auth-${cfg.environment}`;
    const token = JSON.parse(localStorage.getItem(key)).access_token;
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/gostar_scores?month=eq.2026-10&open_id=eq.${encodeURIComponent(openId)}`, {
      method: 'PATCH',
      headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ quality: 1 }),
    });
    return { status: res.status, body: await res.json() };
  }, `sim:${ids.s2.id}`);
  assert.deepEqual(r.body, []); // RLS: no row may be updated
  const q = await sql(`select quality from public.gostar_scores where month = '2026-10' and open_id = $1`, [`sim:${ids.s2.id}`]);
  assert.equal(q[0].quality, 5);
});

await step('Mobile width: the board stays usable at 390 px', async () => {
  const s = await login('s1');
  await s.setViewportSize({ width: 390, height: 900 });
  await s.goto(`${WEB}/gostar`);
  await s.getByText('Đang tạm tính').waitFor();
  await shot(s, '6-mobile');
});

await browser.close();
console.log(fails ? `\n${fails} step(s) failed` : '\nGo Star: all steps passed');
process.exit(fails ? 1 : 0);
