// Browser end-to-end run of the UAT scenarios against the local stack (server.mjs must be running).
// Usage: node tools/local-stack/e2e.mjs <screenshot-dir>
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const API = 'http://127.0.0.1:54321';
// WEB_URL lets the same steps run against the GitHub Pages emulation (http://127.0.0.1:54350/gomedia-ops-hub).
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:54340';
const SHOTS = process.argv[2] ?? './e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const keys = await (await fetch(`${API}/__test/keys`)).json();
const SECRET = createHmac('sha256', keys.botToken).update('go-media-ops-hub/telegram-webhook').digest('hex');
const sql = async (q, p = []) => (await (await fetch(`${API}/__test/sql`, { method: 'POST', body: JSON.stringify({ sql: q, params: p }) })).json()).rows;
const results = [];
const pages = new Set();
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push(['PASS', name, Date.now() - t]);
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push(['FAIL', name, Date.now() - t, e.message]);
    console.log(`FAIL  ${name}\n      ${e.message.split('\n').slice(0, 3).join(' | ')}`);
    let i = 0;
    for (const p of pages) await p.screenshot({ path: `${SHOTS}/FAIL-${results.length}-${i++}.png`, fullPage: true }).catch(() => {});
  }
};

// ---------------------------------------------------------------- reset data ----
await sql(`truncate public.events, public.alerts, public.checkpoints, public.milestones, public.tasks, public.approvals,
           public.quote_lines, public.quotes, public.library_items restart identity cascade`);
await sql(`truncate public.lark_notifications, public.lark_drafts, public.lark_events, public.lark_people`);
await sql(`delete from public.lark_tasks`);
await sql(`update public.settings set lark_mode = 'simulation', lark_notify_d0 = false, lark_notify_time = '09:00'`);
await sql(`alter table public.profiles disable trigger protect_last_admin`);
await sql(`delete from auth.users`);
await sql(`alter table public.profiles enable trigger protect_last_admin`);
await sql(`update public.settings set no_reply_window_hours = 2, holidays = '{}', system_status = '{}', app_url = '${WEB}', telegram_bot_username = null, pilot_start = null, pilot_end = null`);
const users = { admin: 'admin', acc: 'account', acc2: 'account', pm: 'pm', ceo: 'ceo', exec: 'ecom_exec', staff: 'staff' };
for (const [k, role] of Object.entries(users)) {
  await sql(`insert into auth.users (email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, now())`, [
    `${k}@go.vn`,
    JSON.stringify({ ops_role: role }),
    JSON.stringify({ full_name: { admin: 'Long (Admin)', acc: 'An Account', acc2: 'Bình Account', pm: 'Phúc PM', ceo: 'CEO Go Media', exec: 'Hà E-com', staff: 'Thực tập Minh' }[k] }),
  ]);
}
const ids = Object.fromEntries((await sql(`select split_part(email, '@', 1) k, id from public.profiles`)).map((r) => [r.k, r.id]));
await sql(`insert into public.library_items (name, unit, service_group, unit_price) values
  ('Bài Facebook (thiết kế + caption)', 'bài', 'Social Media', 600000),
  ('Kế hoạch nội dung tháng', 'tháng', 'Social Media', 2000000),
  ('Booking micro-KOC', 'booking', 'Influencer', 3500000)`);

// CHROME_BIN points at an installed Chromium when Playwright's own download is not available.
const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {});
async function login(key) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const page = await ctx.newPage();
  pages.add(page);
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

let account, pm, ceo, exec, staff, admin;

await step('Login: magic-link email + 6-digit code; menus follow roles', async () => {
  admin = await login('admin');
  account = await login('acc');
  const nav = await account.getByRole('navigation', { name: 'Điều hướng chính' }).innerText();
  assert.match(nav, /Báo giá/);
  assert.doesNotMatch(nav, /Người dùng|Diagnostics|Thư viện giá/);
  await account.goto(`${WEB}/admin/users`);
  await account.getByText('Bạn không có quyền xem trang này').waitFor();
  await shot(account, '00-account-blocked-admin');
});

await step('Diagnostics: all rule cases PASS in browser and server; connect Telegram', async () => {
  await admin.goto(`${WEB}/admin/diagnostics`);
  await admin.getByText(/PASS ở trình duyệt/).waitFor({ timeout: 15000 });
  await admin.getByRole('button', { name: 'Kết nối webhook Telegram' }).click();
  await admin.getByText(/Đã kết nối webhook/).waitFor();
  await admin.getByText('Webhook Telegram trỏ về ops-hub').waitFor();
  await shot(admin, '01-diagnostics');
});

await step('PM adds a library item from the UI', async () => {
  pm = await login('pm');
  await pm.goto(`${WEB}/library`);
  await pm.getByRole('button', { name: 'Thêm hạng mục' }).click();
  const dlg = pm.getByRole('dialog');
  await dlg.getByLabel('Tên hạng mục').fill('Video TikTok ngắn (≤ 60s)');
  await dlg.getByLabel('Đơn vị').fill('video');
  await dlg.getByLabel('Nhóm dịch vụ').fill('Social Media');
  await dlg.getByLabel('Đơn giá (đ)').fill('1500000');
  await dlg.getByRole('button', { name: 'Lưu' }).click();
  await pm.getByRole('cell', { name: /Video TikTok ngắn/ }).waitFor();
  await shot(pm, '02-library');
});

async function newQuote(page, client, discount, priceTikTok) {
  await page.goto(`${WEB}/quotes`);
  await page.getByRole('button', { name: 'Tạo báo giá' }).click();
  await page.waitForURL(/\/quotes\/[0-9a-f-]{36}$/);
  await page.getByRole('textbox', { name: /^Kính gửi/ }).fill(client);
  // The picker stays open after an add: the first item creates section I (its service group).
  await page.getByRole('button', { name: 'Thêm hạng mục từ Thư viện giá' }).click();
  for (const [item, qty] of [
    ['Video TikTok ngắn', '12'],
    ['Bài Facebook', '8'],
    ['Kế hoạch nội dung', '3'],
  ]) {
    await page.getByRole('option', { name: new RegExp(item) }).first().click();
    await page.getByLabel(new RegExp(`Số lượng: ${item}`)).fill(qty);
  }
  if (priceTikTok) {
    await page.getByLabel(/Đơn giá: Video TikTok/).fill(String(priceTikTok));
    await page.getByLabel(/Lý do giá khác thư viện: Video TikTok/).fill('Khách cần quay 4K');
  }
  await page.locator('#discount').fill(String(discount));
  return page.url().split('/').pop();
}

await step('UAT 1 · in-band quote: 27.360.000 đ, Export PDF & send, appears in archive', async () => {
  await newQuote(account, 'Chuỗi F&B mẫu', 5);
  await account.getByText('Trong khung giá · Account gửi được ngay').waitFor({ timeout: 15000 });
  // 28.800.000 − 5% = 27.360.000 before VAT; + VAT 8% (2.188.800) = 29.548.800 to pay.
  const text = await account.locator('section[aria-label="Báo giá"]').innerText();
  assert.ok(text.includes('2.188.800 đ') && text.includes('29.548.800 đ'), 'VAT 8% and total to pay');
  await shot(account, '03-builder-in-band');
  const dl = account.waitForEvent('download', { timeout: 30000 });
  await account.getByRole('button', { name: 'Xuất PDF & gửi' }).click();
  const file = await dl;
  assert.match(file.suggestedFilename(), /^Q-\d{4}-\d{3}\.pdf$/);
  await file.saveAs(`${SHOTS}/quote.pdf`);
  await account.getByText(/Đã lưu vào Kho tham chiếu/).waitFor({ timeout: 15000 });
  await shot(account, '04-builder-sent');
  const [q] = await sql(`select total, vat_pct, vat_amount, grand_total from public.quotes where client = 'Chuỗi F&B mẫu'`);
  assert.deepEqual([Number(q.total), Number(q.vat_pct), Number(q.vat_amount), Number(q.grand_total)], [27360000, 8, 2188800, 29548800]);
  await account.goto(`${WEB}/archive`);
  await account.getByText('Chuỗi F&B mẫu').first().waitFor();
});

await step('Go Media format · client block, sections, pass-through budget, VAT, terms, PDF preview', async () => {
  await sql(`insert into public.library_items (name, unit, service_group, unit_price, kind) values ('Ngân sách Meta Ads (chi hộ)', 'tháng', 'Quảng cáo', 16000000, 'pass_through')`);
  await account.goto(`${WEB}/quotes`);
  await account.getByRole('button', { name: 'Tạo báo giá' }).click();
  await account.waitForURL(/\/quotes\/[0-9a-f-]{36}$/);
  await account.getByRole('textbox', { name: /^Kính gửi/ }).fill('Skybar mẫu');
  await account.getByLabel('Người liên hệ').fill('Chị Lan, 0905 000 000');
  await account.getByLabel('Dự án').fill('Chạy quảng cáo Q1');
  await account.getByLabel('Địa điểm').fill('Đà Nẵng');
  await account.getByRole('button', { name: 'Thêm hạng mục từ Thư viện giá' }).click();
  await account.getByRole('option', { name: /Kế hoạch nội dung/ }).first().click();
  await account.getByRole('button', { name: 'Thêm phần mới' }).click();
  await account.getByLabel('Tên phần mới').fill('Ngân sách quảng cáo');
  await account.getByRole('button', { name: 'Thêm', exact: true }).first().click();
  await account.getByRole('option', { name: /Ngân sách Meta Ads/ }).first().click();
  // A pass-through budget can change without a reason and never triggers approval.
  await account.getByLabel(/Đơn giá: Ngân sách Meta Ads/).fill('20000000');
  assert.equal(await account.getByLabel(/Lý do giá khác thư viện: Ngân sách/).count(), 0);
  await account.getByLabel(/Phạm vi công việc: Kế hoạch nội dung/).fill('12 bài/tháng, duyệt lịch đăng mỗi thứ Hai');
  await account.locator('#discount').fill('10');
  // Default terms come ticked; untick one, add one for this quote only.
  const t1 = account.getByLabel('Thanh toán 60% tạm ứng trước ngày thực hiện, 40% khi bàn giao sản phẩm.');
  assert.ok(await t1.isChecked());
  await t1.uncheck();
  await account.getByLabel('Thêm điều khoản riêng').fill('Báo cáo hiệu quả gửi mỗi thứ Sáu.');
  await account.getByLabel('Thêm điều khoản riêng').press('Enter');
  await account.getByText('Trong khung giá · Account gửi được ngay').waitFor({ timeout: 15000 });
  // Service 2.000.000 − 10% = 1.800.000; VAT 8% = 144.000; + budget 20.000.000 → 21.944.000.
  const text = await account.locator('section[aria-label="Báo giá"]').innerText();
  assert.ok(text.includes('144.000 đ') && text.includes('21.944.000 đ'), 'VAT only on services; budget added after');
  await account.getByText('Đã lưu').waitFor({ timeout: 15000 });
  await shot(account, '04b-builder-go-media-format');
  await account.getByRole('button', { name: 'Xem trước báo giá (PDF)' }).click();
  const dlg = account.getByRole('dialog');
  await dlg.getByText('TỔNG THANH TOÁN').waitFor();
  for (const t of ['I. Social Media', 'II. Ngân sách quảng cáo', 'Tổng phần II', 'Chị Lan, 0905 000 000', '12 bài/tháng, duyệt lịch đăng mỗi thứ Hai', 'Báo cáo hiệu quả gửi mỗi thứ Sáu.', '(không tính trên khoản chi hộ)']) {
    await dlg.getByText(t, { exact: false }).first().waitFor();
  }
  await dlg.screenshot({ path: `${SHOTS}/04c-pdf-preview.png` });
  await dlg.getByRole('button', { name: 'Đóng' }).click();
  const dl = account.waitForEvent('download', { timeout: 30000 });
  await account.getByRole('button', { name: 'Xuất PDF & gửi' }).click();
  await (await dl).saveAs(`${SHOTS}/quote-go-media-format.pdf`);
  await account.getByText(/Đã lưu vào Kho tham chiếu/).waitFor({ timeout: 15000 });
  const [q] = await sql(`select contact, project, venue, discount_pct, total, vat_amount, grand_total, band_result, terms from public.quotes where client = 'Skybar mẫu'`);
  assert.deepEqual([q.contact, q.project, q.venue, Number(q.total), Number(q.vat_amount), Number(q.grand_total), q.band_result], ['Chị Lan, 0905 000 000', 'Chạy quảng cáo Q1', 'Đà Nẵng', 21800000, 144000, 21944000, 'send_now']);
  assert.equal(q.terms.length, 4);
  assert.ok(q.terms.includes('Báo cáo hiệu quả gửi mỗi thứ Sáu.') && !q.terms.some((t) => t.startsWith('Thanh toán 60%')));
  const lines = await sql(`select l.section, l.kind, l.description from public.quote_lines l join public.quotes q on q.id = l.quote_id where q.client = 'Skybar mẫu' order by position`);
  assert.deepEqual(lines.map((l) => [l.section, l.kind]), [['Social Media', 'service'], ['Ngân sách quảng cáo', 'pass_through']]);
  assert.equal(lines[0].description, '12 bài/tháng, duyệt lịch đăng mỗi thứ Hai');
});

let q2;
await step('UAT 2 · 15% discount → PM queue only; PM approves; account sends', async () => {
  q2 = await newQuote(account, 'Thương hiệu mỹ phẩm', 15);
  await account.getByText('Ngoài khung giá · Cần PM duyệt').waitFor({ timeout: 15000 });
  await shot(account, '05-builder-needs-pm');
  await account.getByRole('button', { name: 'Gửi PM duyệt' }).click();
  await account.getByText('Đang chờ PM duyệt').waitFor();
  ceo = await login('ceo');
  await ceo.goto(`${WEB}/approvals`);
  await ceo.getByText('Không có báo giá nào chờ bạn duyệt').waitFor();
  await pm.goto(`${WEB}/approvals`);
  await pm.getByText('Thương hiệu mỹ phẩm').first().waitFor();
  await shot(pm, '06-approvals-pm');
  await pm.getByRole('button', { name: 'Duyệt', exact: true }).first().click();
  await pm.getByRole('dialog').getByRole('button', { name: 'Duyệt báo giá' }).click();
  await pm.getByText('Không có báo giá nào chờ bạn duyệt').waitFor();
  await account.reload();
  await account.getByText(/Đã được PM duyệt/).waitFor();
  const dl = account.waitForEvent('download', { timeout: 30000 });
  await account.getByRole('button', { name: 'Xuất PDF & gửi' }).click();
  await dl;
  await account.getByText(/Đã lưu vào Kho tham chiếu/).waitFor({ timeout: 15000 });
});

await step('UAT 3 · one price +25% → CEO approval; PM does not see it', async () => {
  await newQuote(account, 'Chuỗi bán lẻ', 5, 1875000);
  await account.getByText('Ngoài khung giá · Cần CEO duyệt').waitFor({ timeout: 15000 });
  await account.getByText(/lệch \+25% so với thư viện/).waitFor();
  await account.getByRole('button', { name: 'Gửi CEO duyệt' }).click();
  await account.getByText('Đang chờ CEO duyệt').waitFor();
  await pm.goto(`${WEB}/approvals`);
  await pm.getByText('Không có báo giá nào chờ bạn duyệt').waitFor();
  await ceo.goto(`${WEB}/approvals`);
  await ceo.getByText('Chuỗi bán lẻ').first().waitFor();
  await ceo.getByRole('button', { name: 'Duyệt', exact: true }).first().click();
  await ceo.getByRole('dialog').getByRole('button', { name: 'Duyệt báo giá' }).click();
  await ceo.getByText('Không có báo giá nào chờ bạn duyệt').waitFor();
});

await step('UAT 4 · PM requests changes: account sees the comment; editing returns to Draft', async () => {
  await newQuote(account, 'Khách cần sửa', 15);
  await account.getByRole('button', { name: 'Gửi PM duyệt' }).click();
  await account.getByText('Đang chờ PM duyệt').waitFor();
  await pm.goto(`${WEB}/approvals`);
  await pm.getByRole('button', { name: 'Yêu cầu sửa' }).first().click();
  await pm.getByRole('dialog').getByLabel(/Account cần sửa gì/).fill('Giảm chiết khấu về 10%');
  await pm.getByRole('dialog').getByRole('button', { name: 'Gửi yêu cầu sửa' }).click();
  await pm.getByText('Không có báo giá nào chờ bạn duyệt').waitFor();
  await account.reload();
  await account.getByText(/Giảm chiết khấu về 10%/).waitFor();
  await shot(account, '07-changes-requested');
  await account.locator('#discount').fill('10');
  await account.getByText('Trong khung giá · Account gửi được ngay').waitFor({ timeout: 15000 });
  await account.getByText('Đã lưu').waitFor({ timeout: 15000 });
  const [row] = await sql(`select status from public.quotes where client = 'Khách cần sửa'`);
  assert.equal(row.status, 'draft');
});

await step('Review by link: PM comments on a line, Account fixes and marks done, then the PDF goes out', async () => {
  const id = await newQuote(account, 'Khách duyệt qua link', 15);
  await account.getByRole('button', { name: 'Gửi PM duyệt' }).click();
  await account.getByText('Đang chờ PM duyệt').waitFor();
  await account.getByRole('button', { name: 'Sao chép link báo giá' }).waitFor();
  // The PM opens the link in a browser that is not signed in: after the code, they land on the quote itself.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const reviewer = await ctx.newPage();
  pages.add(reviewer);
  reviewer.on('pageerror', (e) => console.log(`  [reviewer pageerror] ${e.message}`));
  await reviewer.goto(`${WEB}/quotes/${id}`);
  await reviewer.getByLabel('Email').fill('pm@go.vn');
  await reviewer.getByRole('button', { name: 'Gửi email đăng nhập' }).click();
  await reviewer.getByText('Kiểm tra hộp thư').waitFor();
  const { code } = await (await fetch(`${API}/__test/otp?email=pm@go.vn`)).json();
  await reviewer.getByLabel('Mã trong email').fill(code);
  await reviewer.getByRole('button', { name: 'Đăng nhập' }).click();
  await reviewer.getByText('Quyết định của bạn').waitFor({ timeout: 15000 });
  assert.ok(reviewer.url().endsWith(`/quotes/${id}`));
  // Comment on line 1 and on the totals.
  await reviewer.getByRole('button', { name: /^Góp ý: Dòng 1 · Video TikTok/ }).click();
  await reviewer.getByLabel(/^Góp ý cho: Dòng 1 · Video TikTok/).fill('12 video là nhiều so với ngân sách khách, giảm còn 8');
  await reviewer.getByRole('button', { name: 'Gửi góp ý' }).first().click();
  await reviewer.getByText('12 video là nhiều so với ngân sách khách, giảm còn 8').first().waitFor();
  await reviewer.getByRole('button', { name: /^Góp ý: Chiết khấu, thuế và tổng tiền/ }).click();
  await reviewer.getByLabel('Góp ý cho: Chiết khấu, thuế và tổng tiền').fill('Chiết khấu tối đa 10% cho khách mới');
  await reviewer.getByLabel('Góp ý cho: Chiết khấu, thuế và tổng tiền').press('Control+Enter');
  await reviewer.getByText('2 cần xử lý').waitFor();
  await shot(reviewer, '07b-review-pm-comments');
  // Approving is closed while comments are open; asking for changes needs no extra note.
  assert.ok(await reviewer.getByRole('button', { name: 'Duyệt', exact: true }).isDisabled());
  await reviewer.getByRole('button', { name: 'Yêu cầu sửa', exact: true }).click();
  await reviewer.getByRole('dialog').getByText(/Account sẽ thấy 2 góp ý/).waitFor();
  await reviewer.getByRole('dialog').getByRole('button', { name: 'Gửi yêu cầu sửa' }).click();
  await reviewer.getByText('Đã gửi yêu cầu sửa cho Account').waitFor();

  // The Account sees each comment at its line, fixes, answers and marks them done.
  await account.goto(`${WEB}/quotes`);
  await account.getByText('2 góp ý').first().waitFor();
  await account.goto(`${WEB}/quotes/${id}`);
  await account.getByText(/Còn 2 góp ý đang mở/).waitFor();
  await account.getByText('12 video là nhiều so với ngân sách khách, giảm còn 8').first().waitFor();
  await shot(account, '07c-review-account-sees');
  // Someone whose account was created after the Account opened this page answers: their name must
  // still show (the page loads the list of names only once).
  const [late] = await sql(
    `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ('ceo.moi@go.vn', '{"ops_role":"ceo"}', '{"full_name":"CEO Mới Vào"}') returning id`,
  );
  const [lineThread] = await sql(`select id, anchor, line_id, anchor_label from public.quote_comments where quote_id = $1 and anchor = 'line' and parent_id is null`, [id]);
  await sql(
    `insert into public.quote_comments (quote_id, parent_id, author_id, anchor, line_id, anchor_label, body) values ($1, $2, $3, $4, $5, $6, 'CEO đồng ý với PM')`,
    [id, lineThread.id, late.id, lineThread.anchor, lineThread.line_id, lineThread.anchor_label],
  );
  await account.getByText('CEO đồng ý với PM').waitFor({ timeout: 35000 });
  await account.getByText('CEO Mới Vào').waitFor({ timeout: 10000 });
  await account.getByLabel(/Số lượng: Video TikTok/).fill('8');
  await account.locator('#discount').fill('10');
  await account.getByText('Trong khung giá · Account gửi được ngay').waitFor({ timeout: 15000 });
  await account.getByText(/Còn 2 góp ý chưa xử lý trên báo giá/).waitFor();
  assert.ok(await account.getByRole('button', { name: 'Xuất PDF & gửi' }).isDisabled());
  const totalsThread = account.locator('#cmt-totals');
  await totalsThread.getByRole('button', { name: 'Trả lời' }).click();
  await totalsThread.getByLabel(/^Trả lời góp ý/).fill('Đã giảm về 10%');
  await totalsThread.getByRole('button', { name: 'Gửi trả lời' }).click();
  await totalsThread.getByText('Đã giảm về 10%').waitFor();
  await totalsThread.getByRole('button', { name: 'Đã xử lý' }).click();
  await account.getByText('1 cần xử lý').waitFor();
  await account.getByRole('button', { name: 'Đã xử lý' }).first().click();
  await account.getByText('Đã xử lý hết').waitFor();
  await shot(account, '07d-review-all-done');
  await account.getByText('Đã lưu').waitFor({ timeout: 15000 });
  const dl = account.waitForEvent('download', { timeout: 30000 });
  await account.getByRole('button', { name: 'Xuất PDF & gửi' }).click();
  const file = await dl;
  await file.saveAs(`${SHOTS}/quote-after-review.pdf`);
  await account.getByText(/Đã lưu vào Kho tham chiếu/).waitFor({ timeout: 15000 });
  const [row] = await sql(`select q.status, (select count(*)::int from public.quote_comments c where c.quote_id = q.id and c.parent_id is null and c.resolved_at is not null) done,
                                  (select count(*)::int from public.quote_comments c where c.quote_id = q.id) total from public.quotes q where q.id = $1`, [id]);
  assert.deepEqual(row, { status: 'sent', done: 2, total: 4 });
  // Sent: the comments stay readable, nothing new can be added.
  await account.reload();
  await account.getByText(/Báo giá đã gửi khách: góp ý được giữ lại/).waitFor();
  assert.equal(await account.getByLabel('Góp ý chung cho cả báo giá').count(), 0);
  pages.delete(reviewer);
  await ctx.close();
});

await step('UAT 5 · editing an approved quote sends it back to Draft', async () => {
  await newQuote(account, 'Khách duyệt rồi sửa', 15);
  await account.getByRole('button', { name: 'Gửi PM duyệt' }).click();
  await account.getByText('Đang chờ PM duyệt').waitFor();
  const url = account.url();
  await pm.goto(url);
  await pm.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await pm.getByRole('dialog').getByRole('button', { name: 'Duyệt báo giá' }).click();
  await account.reload();
  await account.getByRole('button', { name: 'Sửa (phải duyệt lại)' }).click();
  await account.getByRole('dialog').getByRole('button', { name: 'Đưa về Nháp để sửa' }).click();
  await account.getByText('Ngoài khung giá · Cần PM duyệt').waitFor({ timeout: 15000 });
  const [row] = await sql(`select status from public.quotes where client = 'Khách duyệt rồi sửa'`);
  assert.equal(row.status, 'draft');
});

await step('UAT 6 · copy items from a similar quote uses today\'s library prices', async () => {
  await sql(`update public.library_items set unit_price = 1600000 where name like 'Video TikTok%'`);
  await account.goto(`${WEB}/quotes`);
  await account.getByRole('button', { name: 'Tạo báo giá' }).click();
  await account.waitForURL(/\/quotes\/[0-9a-f-]{36}$/);
  await account.getByRole('textbox', { name: /^Kính gửi/ }).fill('Khách chép mẫu');
  await account.getByLabel('Nhóm dịch vụ').selectOption('Social Media');
  await account.getByRole('button', { name: 'Chép hạng mục →' }).first().click();
  await account.getByText(/giá lấy theo thư viện hôm nay/).waitFor();
  await account.getByText('Đã lưu').waitFor({ timeout: 15000 });
  const lines = await sql(`select l.item_name, l.unit_price from public.quote_lines l join public.quotes q on q.id = l.quote_id where q.client = 'Khách chép mẫu' order by position`);
  assert.equal(Number(lines.find((l) => /TikTok/.test(l.item_name)).unit_price), 1600000);
  await shot(account, '08-copy-similar');
});

// --------------------------------------------------------------- tasks (S1) ----
function vn(dayOffsetFromNextMonday, hm) {
  const [h, m] = hm.split(':').map(Number);
  const now = new Date(Date.now() + 7 * 3600e3);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const wd = new Date(today).getUTCDay();
  const toMonday = ((8 - wd) % 7) || 7;
  return new Date(today + (toMonday + dayOffsetFromNextMonday) * 86400e3 + (h * 60 + m) * 60e3 - 7 * 3600e3).toISOString();
}
async function cron(route, now) {
  const [{ s }] = await sql(`select public.ops_cron_secret() as s`);
  const r = await fetch(`${API}/functions/v1/ops-hub/${route}`, { method: 'POST', headers: { 'x-cron-secret': s, 'x-test-now': now, 'Content-Type': 'application/json' }, body: '{}' });
  return r.json();
}

await step('Executive creates a task in the form; 4 checkpoints are previewed', async () => {
  exec = await login('exec');
  await exec.goto(`${WEB}/tasks`);
  await exec.getByRole('button', { name: 'Tạo task' }).click();
  const dlg = exec.getByRole('dialog');
  await dlg.getByLabel('Tên task').fill('Banner gian hàng Shopee 11.11');
  await dlg.getByLabel('Người phụ trách').selectOption({ label: 'Thực tập Minh · chỉ web' });
  await dlg.getByLabel('Loại task').selectOption({ label: 'Banner chiến dịch' });
  const toLocal = (iso) => new Date(Date.parse(iso) + 7 * 3600e3).toISOString().slice(0, 16);
  await dlg.getByLabel('Bắt đầu').fill(toLocal(vn(0, '08:00')));
  await dlg.getByLabel('Deadline').fill(toLocal(vn(4, '17:30')));
  await dlg.getByLabel(/Ưu tiên khi có rủi ro/).fill('Xin ảnh sản phẩm từ khách');
  await dlg.getByText(/25% · T3 10:00/).waitFor();
  await dlg.getByText(/99% · T6 17:06/).waitFor();
  await shot(exec, '09-task-form');
  await dlg.getByRole('button', { name: 'Tạo task' }).click();
  await exec.getByText('Banner gian hàng Shopee 11.11').waitFor();
});

await step('UAT 7 · owner answers On plan on the web with an evidence link', async () => {
  await cron('dispatch-checkpoints', vn(1, '10:15'));
  staff = await login('staff');
  await staff.goto(`${WEB}/checkins`);
  await staff.getByText('CHECKPOINT 25%', { exact: false }).waitFor();
  await shot(staff, '10-my-checkins');
  await staff.getByRole('button', { name: /Đúng kế hoạch/ }).click();
  await staff.getByLabel(/Link bằng chứng/).fill('https://drive.example.com/brief');
  await staff.getByRole('button', { name: 'Xác nhận mốc 1 đã xong' }).click();
  await staff.getByText('Không có checkpoint nào đang chờ bạn').waitFor();
  const [m] = await sql(`select done_at is not null as done, evidence_url from public.milestones where idx = 1`);
  assert.deepEqual(m, { done: true, evidence_url: 'https://drive.example.com/brief' });
});

await step('UAT 8 · Behind → At risk alert with done / pending / priority for the executive', async () => {
  await cron('dispatch-checkpoints', vn(2, '12:00'));
  await staff.reload();
  await staff.getByRole('button', { name: 'Chậm hơn kế hoạch' }).click();
  await staff.getByText('Không có checkpoint nào đang chờ bạn').waitFor();
  await exec.goto(`${WEB}/alerts`);
  await exec.getByText('CÓ RỦI RO').first().waitFor();
  const text = await exec.locator('main').innerText();
  assert.match(text, /Đã xong: Chốt brief/);
  assert.match(text, /Đang chờ: Có bản thiết kế nháp/);
  assert.match(text, /Ưu tiên: Xin ảnh sản phẩm từ khách/);
  await shot(exec, '11-alerts');
});

await step('UAT 9 · blocker reported between checkpoints needs a reason and alerts at once', async () => {
  await staff.goto(`${WEB}/checkins`);
  await staff.getByRole('button', { name: 'Báo bị chặn ngay' }).first().click();
  const dlg = staff.getByRole('dialog');
  assert.equal(await dlg.getByRole('button', { name: 'Báo ngay' }).isDisabled(), true);
  await dlg.getByLabel(/Vì sao bị chặn/).fill('Khách chưa gửi ảnh sản phẩm');
  await dlg.getByRole('button', { name: 'Báo ngay' }).click();
  await staff.getByText('BỊ CHẶN').first().waitFor();
  await exec.reload();
  await exec.getByText('Khách chưa gửi ảnh sản phẩm').waitFor();
  await exec.getByRole('button', { name: 'Xác nhận & ghi việc sẽ làm' }).first().click();
  await exec.getByRole('dialog').getByLabel(/Bạn sẽ làm gì/).fill('Đã gọi khách xin ảnh');
  await exec.getByRole('dialog').getByRole('button', { name: 'Xác nhận' }).click();
  await exec.getByText('CÓ RỦI RO').first().waitFor();
});

await step('UAT 10 · silent owner → No reply alert after 2 working hours', async () => {
  await cron('dispatch-checkpoints', vn(3, '15:30'));
  const r = await cron('dispatch-checkpoints', vn(3, '17:00'));
  assert.equal(r.no_reply, 0);
  const r2 = await cron('dispatch-checkpoints', vn(4, '08:01'));
  assert.equal(r2.no_reply, 1);
  await exec.goto(`${WEB}/alerts`);
  await exec.getByText('KHÔNG TRẢ LỜI').first().waitFor();
});

await step('Task board and detail show risk order and the checkpoint timeline', async () => {
  await exec.goto(`${WEB}/tasks`);
  await exec.getByText('BỊ CHẶN').first().waitFor();
  await shot(exec, '12-task-board');
  await exec.getByRole('link', { name: 'Banner gian hàng Shopee 11.11' }).click();
  await exec.getByText('Checkpoint').first().waitFor();
  await shot(exec, '13-task-detail');
});

await step('Dashboard computes KPIs from timestamps and exports CSV', async () => {
  await sql(`update public.settings set pilot_start = (now() at time zone 'Asia/Ho_Chi_Minh')::date - 3, pilot_end = (now() at time zone 'Asia/Ho_Chi_Minh')::date + 20`);
  await ceo.goto(`${WEB}/dashboard`);
  await ceo.getByText('Thời gian báo giá trung bình').first().waitFor({ timeout: 15000 });
  // S1 on the dashboard is read from Lark sub-tasks (M1), no longer from the old checkpoint module.
  await ceo.getByText('Tỷ lệ task con trễ hạn (M1)').waitFor();
  const dlLark = ceo.waitForEvent('download');
  await ceo.getByRole('button', { name: 'CSV task con' }).click();
  assert.match((await dlLark).suggestedFilename(), /^kpi_lark_task_con_/);
  const dl = ceo.waitForEvent('download');
  await ceo.getByRole('button', { name: 'Xuất CSV' }).click();
  const f = await dl;
  assert.match(f.suggestedFilename(), /^kpi_bao_gia_app_/);
  await shot(ceo, '14-dashboard');
});

await step('CEO edits price rules; PM cannot open that page', async () => {
  await ceo.goto(`${WEB}/rules`);
  await ceo.getByRole('button', { name: 'Lưu luật khung giá' }).click();
  await ceo.getByText(/Đã lưu luật khung giá/).waitFor();
  await shot(ceo, '15-price-rules');
  await pm.goto(`${WEB}/rules`);
  await pm.getByText('Bạn không có quyền xem trang này').waitFor();
});

await step('Profile: Telegram link code and deep link', async () => {
  await staff.goto(`${WEB}/profile`);
  await staff.getByRole('button', { name: 'Lấy mã liên kết' }).click();
  await staff.getByRole('link', { name: 'Mở Telegram' }).waitFor();
  const href = await staff.getByRole('link', { name: 'Mở Telegram' }).getAttribute('href');
  assert.match(href, /^https:\/\/t\.me\/gomedia_local_bot\?start=[0-9A-F]{10}$/);
  const code = href.split('=')[1];
  const res = await fetch(`${API}/functions/v1/ops-hub/telegram-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 9001, type: 'private' }, text: `/start ${code}` } }),
  });
  assert.equal(res.status, 200);
  await staff.getByRole('button', { name: /kiểm tra lại/ }).click();
  await staff.getByText('Đã liên kết Telegram').waitFor();
  await shot(staff, '16-profile-linked');
});

await step('Admin: users, settings, demo seed', async () => {
  await admin.goto(`${WEB}/admin/users`);
  await admin.getByText('Thực tập Minh').waitFor();
  await shot(admin, '17-users');
  await admin.goto(`${WEB}/admin/settings`);
  await admin.getByText(/T2 16:30 → T3 09:30 = 2,50 giờ làm việc/).waitFor();
  await shot(admin, '18-settings');
  await admin.goto(`${WEB}/admin/diagnostics`);
  await admin.getByRole('button', { name: 'Nạp lại dữ liệu mẫu' }).click();
  await admin.getByText(/Đã nạp dữ liệu mẫu: 19 báo giá baseline/).waitFor({ timeout: 30000 });
  await admin.getByText('PASS · khớp baseline').waitFor({ timeout: 15000 });
  await admin.getByText('Đây là dữ liệu mẫu tổng hợp').waitFor();
  await shot(admin, '19-diagnostics-baseline');
  // Only the Account role creates quotes: an admin sees the list without a create button.
  await admin.goto(`${WEB}/quotes`);
  await admin.getByText('Chỉ vai trò Account tạo được báo giá mới.').waitFor();
  assert.equal(await admin.getByRole('button', { name: 'Tạo báo giá' }).count(), 0);
  await shot(admin, '19b-admin-quotes');
});

await step('S1 Lark (mô phỏng) · tạo task mẹ/con trên web, mã sai bị chặn, nhắc theo mẫu CEO, Completed thì dừng', async () => {
  const day = (n) => new Date(Date.now() + 7 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
  await exec.goto(`${WEB}/lark`);
  await exec.getByRole('tab', { name: 'Theo dõi task' }).waitFor();
  await exec.getByRole('tab', { name: 'Tạo task' }).click();
  await exec.getByLabel('Mã task mẹ').fill('D56');
  await exec.getByLabel('Deadline tổng').fill(day(10));
  await exec.getByLabel('Tên task mẹ').fill('[STING] Quản lý 1600 KOC video Freecast');
  await exec.getByLabel('Người phụ trách').selectOption({ label: 'Hà E-com' });
  await exec.getByText(/Mã task mẹ "D56" sai format/).waitFor();
  assert.ok(await exec.getByRole('button', { name: 'Xem trước' }).isDisabled());
  await exec.getByLabel('Mã task mẹ').fill('DA056');
  await exec.getByRole('button', { name: 'Xem trước' }).click();
  await exec.getByRole('button', { name: 'Xác nhận tạo' }).click();
  await exec.getByText('Đã tạo task mẹ DA056').waitFor();
  await exec.getByRole('tab', { name: 'Tạo task' }).click();
  await exec.getByRole('button', { name: 'Task con', exact: true }).click();
  await exec.getByLabel('Mã task con').fill('DA057-04-S44');
  await exec.getByLabel('Deadline', { exact: true }).fill(day(2));
  await exec.getByLabel('Tên task con').fill('[STING] Push 50 KOC gửi đủ số lượng video');
  await exec.getByLabel('Người thực hiện').selectOption({ label: 'Thực tập Minh' });
  await exec.getByText(/không thuộc task mẹ DA056/).waitFor();
  await exec.getByLabel('Mã task con').fill('DA056-04-S44');
  await exec.getByRole('button', { name: 'Xem trước' }).click();
  await shot(exec, '20-lark-create-preview');
  await exec.getByRole('button', { name: 'Xác nhận tạo' }).click();
  await exec.getByText('Đã tạo task con DA056-04-S44').waitFor();
  await exec.getByRole('button', { name: 'Chạy kiểm tra ngay' }).click();
  await exec.getByText(/Đã kiểm tra: 1 nhắc việc/).waitFor();
  await exec.getByRole('tab', { name: 'Group Lark' }).click();
  await exec.getByText('🔴 Task sắp đến hạn – Còn 2 ngày!').waitFor();
  await exec.getByText('@Thực tập Minh').waitFor();
  await exec.getByText('[DA056] [STING] Quản lý 1600 KOC video Freecast').waitFor();
  await shot(exec, '21-lark-group');
  await exec.getByRole('tab', { name: 'Theo dõi task' }).click();
  await exec.getByRole('button', { name: 'Cập nhật', exact: true }).click();
  await exec.getByRole('button', { name: 'Đánh dấu Completed' }).click();
  await exec.getByRole('button', { name: 'Chạy kiểm tra ngay' }).click();
  await exec.getByText(/Đã kiểm tra: 0 nhắc việc, 1 xác nhận hoàn thành/).waitFor();
  await exec.getByText('Hoàn thành', { exact: true }).waitFor();
  await shot(exec, '22-lark-track');
  await exec.getByRole('tab', { name: 'Group Lark' }).click();
  await exec.getByText('✅ Task đã hoàn thành!').waitFor();
  // Admin page: setup guide and the events URL
  await admin.goto(`${WEB}/lark/setup`);
  await admin.getByText(/\/ops-hub\/lark-events/).waitFor();
  await shot(admin, '23-lark-setup');
});

await step('Mobile width: builder and check-ins stay usable at 390 px', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'vi-VN' });
  const p = await ctx.newPage();
  await p.goto(WEB);
  await p.getByLabel('Email').fill('acc@go.vn');
  await p.getByRole('button', { name: 'Gửi email đăng nhập' }).click();
  await p.getByText('Kiểm tra hộp thư').waitFor();
  const { code } = await (await fetch(`${API}/__test/otp?email=acc@go.vn`)).json();
  await p.getByLabel('Mã trong email').fill(code);
  await p.getByRole('button', { name: 'Đăng nhập' }).click();
  await p.getByRole('button', { name: 'Mở menu' }).waitFor();
  await p.goto(`${WEB}/quotes`);
  await p.getByText('Danh sách').waitFor();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
  await shot(p, '20-mobile-quotes');
});

await browser.close();
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} steps passed`);
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
