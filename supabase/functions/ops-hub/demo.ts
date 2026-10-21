// Demo workspace seed (only when the function runs with APP_ENV=demo).
// Every record is synthetic and marked DEMO; nothing here comes from Go Media.
import {
  addDays,
  addWorkingHours,
  addWorkingMs,
  Answer,
  answerEffect,
  bandCheck,
  CHECKPOINT_PCTS,
  checkpointTimes,
  closeOutcome,
  isoWeekday,
  localToMs,
  quoteTotals,
  statusAfterSilence,
  TaskStatus,
  toLocalParts,
  WorkCalendar,
  workingMsBetween,
} from '../../../src/domain/index';
import { calendarOf, Ctx, loadRules, loadSettings, Profile, requireRole } from './context';
import { ApiError, must, randomToken } from './http';

const DEMO_DOMAIN = 'demo.gomedia.example.com';

const PEOPLE = [
  { key: 'acc-a', name: 'Account A (mẫu)', role: 'account' },
  { key: 'acc-b', name: 'Account B (mẫu)', role: 'account' },
  { key: 'intern-a', name: 'Thực tập sinh A (mẫu)', role: 'staff' },
  { key: 'intern-b', name: 'Thực tập sinh B (mẫu)', role: 'staff' },
  { key: 'intern-c', name: 'Thực tập sinh C (mẫu)', role: 'staff' },
  { key: 'intern-d', name: 'Thực tập sinh D (mẫu)', role: 'staff' },
] as const;

const LIBRARY = [
  ['DEMO-SOC-01', 'Video TikTok ngắn (≤ 60s)', 'video', 'Social Media', 1_500_000],
  ['DEMO-SOC-02', 'Bài đăng Facebook (thiết kế + caption)', 'bài', 'Social Media', 600_000],
  ['DEMO-SOC-03', 'Kế hoạch nội dung tháng', 'tháng', 'Social Media', 2_000_000],
  ['DEMO-INF-01', 'Booking micro-KOC', 'booking', 'Influencer', 3_500_000],
  ['DEMO-ECO-01', 'Livestream bán hàng (2 giờ)', 'buổi', 'E-commerce', 4_000_000],
  ['DEMO-ECO-02', 'Bộ banner gian hàng sàn TMĐT', 'bộ', 'E-commerce', 1_200_000],
  ['DEMO-ECO-03', 'Tối ưu SEO trang sản phẩm', 'trang', 'E-commerce', 250_000],
  ['DEMO-MED-01', 'Chụp ảnh sản phẩm (nửa ngày)', 'buổi', 'Media Production', 5_000_000],
  ['DEMO-MED-02', 'Quay dựng video sản phẩm', 'video', 'Media Production', 2_500_000],
  ['DEMO-PER-01', 'Phí quản lý quảng cáo', 'tháng', 'Performance', 3_000_000],
] as const;

/** 19 synthetic baseline quotes: 9 with a reference (avg 7.0 h, 2 late) and 10 recalculated (avg 10.15 h, 8 late). */
const BASELINE_HOURS = [4, 5, 6, 6.5, 7, 7.5, 8, 9.5, 9.5, 6, 7.5, 9, 9.5, 10, 11, 11.5, 12, 12.5, 12.5];

function requireDemo(ctx: Ctx, user: Profile) {
  requireRole(user, 'admin');
  if (ctx.env.appEnv !== 'demo') throw new ApiError(403, 'not_demo', 'Chỉ dùng ở bản Demo (đặt APP_ENV=demo trong Edge Function Secrets của project demo).');
}

async function demoUserIds(ctx: Ctx): Promise<string[]> {
  const rows = must(await ctx.db.from('profiles').select('id').like('email', `%@${DEMO_DOMAIN}`), 'demo users') as { id: string }[];
  return rows.map((r) => r.id);
}

export async function clearDemo(ctx: Ctx, user: Profile) {
  requireDemo(ctx, user);
  const ids = await demoUserIds(ctx);
  if (ids.length) {
    must(await ctx.db.from('tasks').delete().in('owner_id', ids).select('id'), 'delete demo tasks');
    must(await ctx.db.from('quotes').delete().in('created_by', ids).select('id'), 'delete demo quotes');
  }
  must(await ctx.db.from('quotes').delete().like('code', 'DEMO-%').select('id'), 'delete demo quote codes');
  must(await ctx.db.from('library_items').delete().like('code', 'DEMO-%').select('id'), 'delete demo library');
  for (const id of ids) await ctx.db.auth.admin.deleteUser(id);
  return { removedUsers: ids.length };
}

function at(cal: WorkCalendar, day: { year: number; month: number; day: number }, hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return localToMs(day.year, day.month, day.day, h, m, cal.timeZone);
}

/** Monday of the current local week, and of the week before. */
function weeks(now: number, cal: WorkCalendar) {
  const p = toLocalParts(now, cal.timeZone);
  const thisMon = addDays(p.year, p.month, p.day, -(isoWeekday(p.year, p.month, p.day) - 1));
  const lastMon = addDays(thisMon.year, thisMon.month, thisMon.day, -7);
  return { thisMon, lastMon };
}

export async function seedDemo(ctx: Ctx, user: Profile) {
  requireDemo(ctx, user);
  await clearDemo(ctx, user);
  const s = await loadSettings(ctx.db);
  const cal = calendarOf(s);
  const rules = await loadRules(ctx.db);
  const now = ctx.now();

  // People
  const who: Record<string, string> = {};
  for (const p of PEOPLE) {
    const { data, error } = await ctx.db.auth.admin.createUser({
      email: `${p.key}@${DEMO_DOMAIN}`,
      email_confirm: true,
      app_metadata: { ops_role: p.role },
      user_metadata: { full_name: p.name },
    });
    if (error) throw new Error(`create demo user: ${error.message}`);
    who[p.key] = data.user!.id;
    await ctx.db.from('profiles').update({ full_name: p.name, role: p.role }).eq('id', data.user!.id);
  }

  // Library: reuse items that already exist with the same name and unit (e.g. added by the PM).
  type Lib = { id: string; code: string | null; name: string; unit: string; service_group: string; unit_price: number };
  const existing = must(await ctx.db.from('library_items').select('id, code, name, unit, service_group, unit_price'), 'load library') as Lib[];
  const key = (name: string, unit: string) => `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
  const have = new Map(existing.map((l) => [key(l.name, l.unit), l]));
  const missing = LIBRARY.filter(([, name, unit]) => !have.has(key(name, unit)));
  const inserted = missing.length
    ? (must(
        await ctx.db
          .from('library_items')
          .insert(missing.map(([code, name, unit, group, price]) => ({ code, name, unit, service_group: group, unit_price: price })))
          .select('id, code, name, unit, service_group, unit_price'),
        'insert library',
      ) as Lib[])
    : [];
  for (const l of inserted) have.set(key(l.name, l.unit), l);
  const byCode = new Map(LIBRARY.map(([code, name, unit]) => [code, have.get(key(name, unit))!]));
  const item = (code: string) => {
    const l = byCode.get(code)!;
    return { ...l, unit_price: Number(l.unit_price) };
  };

  // 19 synthetic baseline quotes (Jul–Sep 2026), imported history
  const baseline = BASELINE_HOURS.map((h, i) => {
    const month = 7 + Math.floor(i / 7);
    let day = { year: 2026, month, day: 3 + (i % 7) * 3 };
    while (isoWeekday(day.year, day.month, day.day) > 5) day = addDays(day.year, day.month, day.day, 1);
    const requested = at(cal, day, i % 2 ? '09:00' : '14:00');
    const sent = addWorkingHours(requested, h, cal).getTime();
    const scope = i % 3 === 0 ? ['DEMO-SOC-01', 'DEMO-SOC-02', 'DEMO-SOC-03'] : i % 3 === 1 ? ['DEMO-INF-01', 'DEMO-SOC-01'] : ['DEMO-ECO-01', 'DEMO-ECO-02', 'DEMO-PER-01'];
    const lines = scope.map((code, k) => ({ item: item(code), qty: k === 0 ? 6 + (i % 7) : 2 + (i % 3) }));
    const discount = [0, 5, 8, 10][i % 4];
    const totals = quoteTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.item.unit_price })), discount);
    return {
      code: `DEMO-H-${String(i + 1).padStart(2, '0')}`,
      client: `Khách mẫu ${String(i + 1).padStart(2, '0')}`,
      service_group: lines[0].item.service_group,
      requested_at: new Date(requested).toISOString(),
      sent_at: new Date(sent).toISOString(),
      discount_pct: discount,
      subtotal: totals.subtotal,
      total: totals.total,
      lines: lines.map((l) => ({ library_item_id: l.item.id, item_name: l.item.name, unit: l.item.unit, qty: l.qty, unit_price: l.item.unit_price, library_price: l.item.unit_price })),
    };
  });
  must(await ctx.db.rpc('ops_import_quotes', { p: { actor: who['acc-a'], quotes: baseline } }), 'import baseline');

  // Pilot-period quotes made in the app (last week and this week)
  const { thisMon, lastMon } = weeks(now, cal);
  const pilotQuotes = [
    { by: 'acc-a', day: lastMon, at: '09:00', hours: 2.5, lines: [['DEMO-SOC-01', 12, 0], ['DEMO-SOC-02', 8, 0], ['DEMO-SOC-03', 3, 0]], disc: 5 },
    { by: 'acc-b', day: addDays(lastMon.year, lastMon.month, lastMon.day, 1), at: '10:30', hours: 3, lines: [['DEMO-INF-01', 4, 0], ['DEMO-SOC-01', 6, 0]], disc: 0 },
    { by: 'acc-a', day: addDays(lastMon.year, lastMon.month, lastMon.day, 2), at: '14:00', hours: 6.5, lines: [['DEMO-ECO-01', 4, 0], ['DEMO-ECO-02', 2, 0]], disc: 15 },
    { by: 'acc-b', day: addDays(lastMon.year, lastMon.month, lastMon.day, 3), at: '08:30', hours: 9, lines: [['DEMO-MED-01', 2, 0.25], ['DEMO-MED-02', 3, 0]], disc: 5 },
    { by: 'acc-a', day: thisMon, at: '09:30', hours: 1.5, lines: [['DEMO-SOC-01', 10, 0], ['DEMO-SOC-03', 3, 0]], disc: 8 },
  ];
  for (const [i, q] of pilotQuotes.entries()) {
    const requested = at(cal, q.day, q.at);
    const sent = addWorkingHours(requested, q.hours, cal).getTime();
    if (sent > now) continue;
    const lines = q.lines.map(([code, qty, dev]) => {
      const it = item(code as string);
      return { it, qty: qty as number, price: Math.round(it.unit_price * (1 + (dev as number))) };
    });
    const band = bandCheck(lines.map((l) => ({ name: l.it.name, qty: l.qty, unitPrice: l.price, libraryPrice: l.it.unit_price })), q.disc, rules);
    const totals = quoteTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.price })), q.disc);
    const quote = must(
      await ctx.db
        .from('quotes')
        .insert({
          code: `DEMO-Q-${String(i + 1).padStart(2, '0')}`,
          client: `Khách mẫu ${String(20 + i)}`,
          service_group: lines[0].it.service_group,
          requested_at: new Date(requested).toISOString(),
          sent_at: new Date(sent).toISOString(),
          status: 'sent',
          discount_pct: q.disc,
          subtotal: totals.subtotal,
          total: totals.total,
          band_result: band.level,
          approver: band.level === 'send_now' ? null : band.level,
          created_by: who[q.by],
        })
        .select('id')
        .single(),
      'demo quote',
    ) as { id: string };
    await ctx.db.from('quote_lines').insert(
      lines.map((l, k) => ({
        quote_id: quote.id,
        position: k + 1,
        library_item_id: l.it.id,
        item_name: l.it.name,
        unit: l.it.unit,
        qty: l.qty,
        unit_price: l.price,
        library_price: l.it.unit_price,
        override_reason: l.price !== l.it.unit_price ? 'Phạm vi đặc thù (mẫu)' : null,
      })),
    );
    if (band.level !== 'send_now') {
      await ctx.db.from('approvals').insert({ quote_id: quote.id, level: band.level, approver_id: user.id, decision: 'approve', comment: 'Duyệt (dữ liệu mẫu)', decided_at: new Date(sent - 30 * 60_000).toISOString() });
    }
  }

  // Tasks: last week (closed) and this week (in progress), simulated with the domain rules.
  const types = must(await ctx.db.from('task_types').select('id, name, milestone_1, milestone_2, milestone_3, milestone_4'), 'types') as {
    id: string;
    name: string;
    milestone_1: string;
    milestone_2: string;
    milestone_3: string;
    milestone_4: string;
  }[];
  const scripts: { name: string; owner: string; type: number; week: 'last' | 'this'; answers: (Answer | null)[]; priority: string }[] = [
    { name: 'Shortlist KOC cho thương hiệu mỹ phẩm (mẫu)', owner: 'intern-a', type: 0, week: 'last', answers: ['on_plan', 'on_plan', 'behind', 'on_plan'], priority: 'Liên hệ KOC dự phòng ngay hôm nay' },
    { name: 'Dựng video sản phẩm chăm sóc da (mẫu)', owner: 'intern-b', type: 1, week: 'last', answers: ['on_plan', 'blocked', 'on_plan', 'on_plan'], priority: 'Account nhắc khách gửi góp ý' },
    { name: 'SEO 20 trang sản phẩm (mẫu)', owner: 'intern-c', type: 2, week: 'last', answers: ['on_plan', 'on_plan', 'on_plan', 'on_plan'], priority: 'Xong meta title trước khi đăng' },
    { name: 'Banner chiến dịch 11.11 (mẫu)', owner: 'intern-d', type: 3, week: 'last', answers: ['on_plan', null, 'behind', 'behind'], priority: 'Nhờ designer hỗ trợ bản nháp' },
    { name: 'Booking KOC cho chuỗi F&B (mẫu)', owner: 'intern-a', type: 0, week: 'this', answers: ['on_plan', 'on_plan', 'on_plan', 'on_plan'], priority: 'Chốt KOC trước thứ Năm' },
    { name: 'Video unbox sản phẩm mới (mẫu)', owner: 'intern-b', type: 1, week: 'this', answers: ['on_plan', 'behind', 'on_plan', 'on_plan'], priority: 'Ưu tiên bản dựng thô' },
    { name: 'Banner gian hàng Shopee (mẫu)', owner: 'intern-d', type: 3, week: 'this', answers: [null, 'on_plan', 'on_plan', 'on_plan'], priority: 'Xin ảnh sản phẩm từ khách' },
  ];
  let createdTasks = 0;
  for (const sc of scripts) {
    const mon = sc.week === 'last' ? lastMon : thisMon;
    const fri = addDays(mon.year, mon.month, mon.day, 4);
    const start = at(cal, mon, '08:00');
    const due = at(cal, fri, '17:30');
    const ty = types[sc.type % types.length];
    const times = checkpointTimes(start, due, cal).map((d) => d.getTime());
    const task = must(
      await ctx.db
        .from('tasks')
        .insert({ name: sc.name, owner_id: who[sc.owner], type_id: ty.id, start_at: new Date(start).toISOString(), due_at: new Date(due).toISOString(), priority_note: sc.priority, created_by: user.id })
        .select('id')
        .single(),
      'demo task',
    ) as { id: string };
    createdTasks++;
    const labels = [ty.milestone_1, ty.milestone_2, ty.milestone_3, ty.milestone_4];
    const doneAt: (number | null)[] = [null, null, null, null];
    let state: { doneCount: number; status: TaskStatus } = { doneCount: 0, status: 'not_started' };
    const cpRows: Record<string, unknown>[] = [];
    const alerts: Record<string, unknown>[] = [];
    times.forEach((t, i) => {
      const row: Record<string, unknown> = { task_id: task.id, pct: CHECKPOINT_PCTS[i], scheduled_at: new Date(t).toISOString(), token: randomToken() };
      if (t <= now && t <= due) {
        // Sending a newer checkpoint retires older unanswered ones, as the real dispatcher does.
        for (const prev of cpRows) if (prev.sent_at && !prev.answered_at && !prev.expired_at) prev.expired_at = new Date(t).toISOString();
        row.sent_at = new Date(t).toISOString();
        row.sent_via = 'web';
        const a = sc.answers[i];
        const answeredAt = addWorkingMs(t, 20 * 60_000, cal);
        if (a && answeredAt <= now) {
          const reason = a === 'blocked' ? 'Khách chưa gửi góp ý (mẫu)' : null;
          const eff = answerEffect(state, (i + 1) as 1 | 2 | 3 | 4, a, reason);
          for (const k of eff.markDone) doneAt[k - 1] = answeredAt;
          state = { doneCount: eff.doneCount, status: eff.status };
          Object.assign(row, { answered_at: new Date(answeredAt).toISOString(), answer: a, answer_via: 'web', answer_reason: reason });
          if (eff.alert) alerts.push({ task_id: task.id, kind: eff.alert.kind, reason: eff.alert.reason, created_at: new Date(answeredAt).toISOString(), notified_at: new Date(answeredAt).toISOString() });
        } else if (!a) {
          const silentAt = addWorkingMs(t, s.no_reply_window_hours * 3_600_000, cal);
          if (silentAt <= now && workingMsBetween(t, Math.min(now, due), cal) >= s.no_reply_window_hours * 3_600_000) {
            row.no_reply_alerted_at = new Date(silentAt).toISOString();
            state = { ...state, status: statusAfterSilence(state.status) };
            alerts.push({ task_id: task.id, kind: 'no_reply', reason: `Không trả lời checkpoint ${CHECKPOINT_PCTS[i]}% (mẫu)`, created_at: new Date(silentAt).toISOString(), notified_at: new Date(silentAt).toISOString() });
          }
        }
      }
      cpRows.push(row);
    });
    const ms = labels.map((label, i) => ({ task_id: task.id, idx: i + 1, label, done_at: doneAt[i] ? new Date(doneAt[i] as number).toISOString() : null }));
    must(await ctx.db.from('milestones').insert(ms).select('id'), 'demo milestones');
    must(await ctx.db.from('checkpoints').insert(cpRows).select('id'), 'demo checkpoints');
    let closed: Record<string, unknown> = { status: state.status };
    if (due <= now) {
      const outcome = closeOutcome(doneAt, due);
      closed = { status: outcome === 'on_time' ? 'done' : 'overdue', closed_as: outcome, closed_at: new Date(due).toISOString() };
      if (outcome === 'overdue') alerts.push({ task_id: task.id, kind: 'overdue', reason: 'Trễ deadline (mẫu)', created_at: new Date(due).toISOString(), notified_at: new Date(due).toISOString() });
      await ctx.db.from('checkpoints').update({ expired_at: new Date(due).toISOString() }).eq('task_id', task.id).is('answered_at', null);
    }
    await ctx.db.from('tasks').update(closed).eq('id', task.id);
    if (alerts.length) must(await ctx.db.from('alerts').insert(alerts).select('id'), 'demo alerts');
  }

  const pilotEnd = addDays(thisMon.year, thisMon.month, thisMon.day, 4);
  const iso = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  await ctx.db.from('settings').update({ pilot_start: iso(lastMon), pilot_end: iso(pilotEnd) }).eq('id', 1);
  await ctx.db.from('events').insert({ actor: user.id, entity: 'system', entity_id: null, action: 'demo.seeded', payload: { tasks: createdTasks } });
  return { users: PEOPLE.length, library: LIBRARY.length, baselineQuotes: baseline.length, tasks: createdTasks };
}
