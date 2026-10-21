import { describe, expect, it } from 'vitest';
import {
  addWorkingHours,
  answerEffect,
  at,
  bandCheck,
  baselineCheck,
  checkpointResponseRate,
  checkpointTimes,
  closeOutcome,
  copyLinesWithTodayPrices,
  DEFAULT_BAND_RULES,
  DEFAULT_CALENDAR,
  earlyWarningRate,
  fmtLocal,
  fmtVnLong,
  fmtVnShort,
  isWorkingTime,
  localToMs,
  localWeekStart,
  nextQuoteStatus,
  nextWorkingMinute,
  noReplyDue,
  overdueRate,
  parseLocalDateTime,
  parseNumber,
  parseVnd,
  planDispatch,
  publicBand,
  quoteKpis,
  quoteTotals,
  rankSimilar,
  runDomainCases,
  turnaroundByBand,
  validateCalendar,
  validateLibraryRows,
  validateQuoteHistoryRows,
  validateTaskDraft,
  validateTaskRows,
  weeklyTurnaround,
  WorkCalendar,
  workingHoursBetween,
} from './index';

const cal = DEFAULT_CALENDAR;

describe('PRD test table (Diagnostics cases)', () => {
  const results = runDomainCases();
  it('has the cases', () => expect(results.length).toBeGreaterThanOrEqual(15));
  for (const r of results) {
    it(`#${r.id} ${r.rule}: ${r.input}`, () => {
      expect(r.actual).toBe(r.expected);
      expect(r.pass).toBe(true);
    });
  }
});

describe('working-hours calendar', () => {
  it('is 0 when end is not after start', () => {
    expect(workingHoursBetween(at('Tue', '10:00'), at('Tue', '10:00'), cal)).toBe(0);
    expect(workingHoursBetween(at('Tue', '10:00'), at('Mon', '10:00'), cal)).toBe(0);
  });
  it('counts a full week as 40 hours', () => {
    expect(workingHoursBetween(at('Mon', '00:00'), at('Sat', '00:00'), cal)).toBe(40);
  });
  it('ignores time outside blocks and weekends', () => {
    expect(workingHoursBetween(at('Mon', '06:00'), at('Mon', '07:59'), cal)).toBe(0);
    expect(workingHoursBetween(at('Sat', '08:00'), at('Sun', '18:00'), cal)).toBe(0);
    expect(workingHoursBetween(at('Mon', '12:00'), at('Mon', '13:30'), cal)).toBe(0);
  });
  it('skips listed holidays', () => {
    const withHoliday: WorkCalendar = { ...cal, holidays: ['2026-10-06'] };
    expect(workingHoursBetween(at('Mon', '16:30'), at('Wed', '09:30'), withHoliday)).toBe(2.5);
  });
  it('adds working hours across lunch, nights and weekends', () => {
    expect(fmtLocal(addWorkingHours(at('Mon', '11:00'), 2, cal))).toBe('Mon 14:30');
    expect(fmtLocal(addWorkingHours(at('Fri', '17:00'), 1, cal))).toBe('Mon 08:30');
    expect(fmtLocal(addWorkingHours(at('Mon', '07:00'), 0, cal))).toBe('Mon 08:00');
    expect(fmtLocal(addWorkingHours(at('Mon', '08:00'), 4, cal))).toBe('Mon 12:00');
  });
  it('treats block edges as working time', () => {
    expect(isWorkingTime(at('Wed', '12:00'), cal)).toBe(true);
    expect(isWorkingTime(at('Wed', '12:01'), cal)).toBe(false);
    expect(isWorkingTime(at('Sat', '10:00'), cal)).toBe(false);
    expect(fmtLocal(nextWorkingMinute(at('Wed', '12:30'), cal))).toBe('Wed 13:30');
  });
  it('works in a zone with daylight saving', () => {
    const ny: WorkCalendar = { ...cal, timeZone: 'America/New_York' };
    // 2026-11-01 is the DST change in New York; Fri 30 Oct 16:00 → Mon 2 Nov 10:00 = 1.5 + 2
    const a = localToMs(2026, 10, 30, 16, 0, ny.timeZone);
    const b = localToMs(2026, 11, 2, 10, 0, ny.timeZone);
    expect(workingHoursBetween(a, b, ny)).toBe(3.5);
  });
  it('validates calendars', () => {
    expect(validateCalendar(cal)).toEqual([]);
    expect(validateCalendar({ ...cal, blocks: [{ start: '13:00', end: '12:00' }] }).length).toBeGreaterThan(0);
    expect(validateCalendar({ ...cal, blocks: [{ start: '08:00', end: '12:00' }, { start: '11:00', end: '13:00' }] }).length).toBeGreaterThan(0);
    expect(validateCalendar({ ...cal, workDays: [] }).length).toBeGreaterThan(0);
    expect(validateCalendar({ ...cal, timeZone: 'Mars/Base' }).length).toBeGreaterThan(0);
  });
});

describe('price band', () => {
  const line = (unitPrice: number, libraryPrice: number | null = 1_000_000) => ({ name: 'X', qty: 2, unitPrice, libraryPrice });
  it('keeps exactly 10% inside the self-send band', () => {
    expect(bandCheck([line(1_100_000)], 10).level).toBe('send_now');
    expect(bandCheck([line(900_000)], 0).level).toBe('send_now');
  });
  it('moves just above 10% to the PM and above 20% to the CEO', () => {
    expect(bandCheck([line(1_100_001)], 0).level).toBe('pm');
    expect(bandCheck([line(1_000_000)], 10.5).level).toBe('pm');
    expect(bandCheck([line(1_000_000)], 20.5).level).toBe('ceo');
    expect(bandCheck([line(790_000)], 0).level).toBe('ceo');
  });
  it('sends lines without a library price to the CEO', () => {
    expect(bandCheck([line(1_000_000, null)], 0).level).toBe('ceo');
  });
  it('uses an item band for the self-send level when set', () => {
    const l = { name: 'X', qty: 1, unitPrice: 1_120_000, libraryPrice: 1_000_000, bandLow: 950_000, bandHigh: 1_150_000 };
    expect(bandCheck([l], 0).level).toBe('send_now');
    expect(bandCheck([{ ...l, unitPrice: 940_000 }], 0).level).toBe('pm');
  });
  it('applies a margin floor when the CEO sets one', () => {
    const rules = DEFAULT_BAND_RULES.map((r) => (r.level === 'send_now' ? { ...r, marginFloorPct: 85 } : r));
    // 9% discount + all prices −9% → 82.8% of library value: below the 85% floor
    expect(bandCheck([line(910_000)], 9, rules).level).toBe('pm');
    expect(bandCheck([line(1_000_000)], 9, rules).level).toBe('send_now');
  });
  it('explains the reason without revealing limits to the Account', () => {
    const r = bandCheck([line(1_250_000)], 5);
    expect(r.level).toBe('ceo');
    expect(r.reasons[0]).toMatchObject({ code: 'deviation', value: 25, limit: 20 });
    const pub = publicBand(r);
    expect(JSON.stringify(pub)).not.toContain('limit');
  });
  it('rejects invalid input', () => {
    expect(() => bandCheck([line(1)], 120)).toThrow();
    expect(() => bandCheck([{ ...line(1), qty: 0 }], 0)).toThrow();
  });
});

describe('quote lifecycle and maths', () => {
  it('follows Draft → Sent in band', () => {
    expect(nextQuoteStatus('draft', 'send', 'send_now')).toEqual({ ok: true, status: 'sent' });
    expect(nextQuoteStatus('draft', 'send', 'pm').ok).toBe(false);
  });
  it('follows Draft → Pending → Approved → Sent', () => {
    expect(nextQuoteStatus('draft', 'submit', 'pm')).toEqual({ ok: true, status: 'pending' });
    expect(nextQuoteStatus('pending', 'approve')).toEqual({ ok: true, status: 'approved' });
    expect(nextQuoteStatus('approved', 'send')).toEqual({ ok: true, status: 'sent' });
  });
  it('follows Pending → Changes requested → Draft', () => {
    expect(nextQuoteStatus('pending', 'request_changes')).toEqual({ ok: true, status: 'changes_requested' });
    expect(nextQuoteStatus('changes_requested', 'edit')).toEqual({ ok: true, status: 'draft' });
    expect(nextQuoteStatus('changes_requested', 'send', 'send_now').ok).toBe(false);
  });
  it('returns to Draft on any edit after Pending or Approved', () => {
    expect(nextQuoteStatus('pending', 'edit')).toEqual({ ok: true, status: 'draft' });
    expect(nextQuoteStatus('approved', 'edit')).toEqual({ ok: true, status: 'draft' });
  });
  it('refuses in-band submit and edits after sending', () => {
    expect(nextQuoteStatus('draft', 'submit', 'send_now').ok).toBe(false);
    expect(nextQuoteStatus('sent', 'edit').ok).toBe(false);
  });
  it('rounds to whole đồng', () => {
    expect(quoteTotals([{ qty: 3, unitPrice: 333_333 }], 7)).toEqual({ subtotal: 999_999, discountAmount: 70_000, total: 929_999 });
  });
  it('copies lines with today prices and skips retired items', () => {
    const library = new Map([
      ['tt', { id: 'tt', name: 'TikTok', unit: 'video', unitPrice: 1_600_000, active: true }],
      ['old', { id: 'old', name: 'Old', unit: 'x', unitPrice: 1, active: false }],
    ]);
    const res = copyLinesWithTodayPrices(
      [
        { libraryItemId: 'tt', itemName: 'TikTok', qty: 10 },
        { libraryItemId: 'old', itemName: 'Old', qty: 1 },
        { libraryItemId: null, itemName: 'Custom', qty: 1 },
      ],
      library,
    );
    expect(res.lines).toEqual([{ libraryItemId: 'tt', itemName: 'TikTok', unit: 'video', qty: 10, unitPrice: 1_600_000, libraryPrice: 1_600_000 }]);
    expect(res.skipped).toEqual(['Old', 'Custom']);
  });
  it('ranks similar quotes by service group, then shared items', () => {
    const archive = [
      { id: 'a', serviceGroup: 'Social', itemIds: ['tt'], sentAt: 1 },
      { id: 'b', serviceGroup: 'Social', itemIds: ['tt', 'fb', 'plan'], sentAt: 2 },
      { id: 'c', serviceGroup: 'Influencer', itemIds: ['tt', 'fb', 'plan', 'koc'], sentAt: 3 },
      { id: 'd', serviceGroup: 'Performance', itemIds: ['ads'], sentAt: 4 },
    ];
    expect(rankSimilar({ serviceGroup: 'Social', itemIds: ['tt', 'fb', 'plan'] }, archive).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('checkpoints and answers', () => {
  it('schedules a one-working-hour task', () => {
    const times = checkpointTimes(at('Mon', '08:00'), at('Mon', '09:00'), cal).map((d) => fmtLocal(d));
    expect(times).toEqual(['Mon 08:15', 'Mon 08:30', 'Mon 08:45', 'Mon 08:59']);
  });
  it('refuses a task with no working time', () => {
    expect(() => checkpointTimes(at('Sat', '08:00'), at('Sun', '18:00'), cal)).toThrow();
  });
  it('on plan marks every milestone up to the checkpoint', () => {
    expect(answerEffect({ doneCount: 0, status: 'not_started' }, 2, 'on_plan')).toEqual({ doneCount: 2, status: 'on_track', markDone: [1, 2], alert: null });
  });
  it('blocked needs a reason and raises a blocker alert, also between checkpoints', () => {
    expect(() => answerEffect({ doneCount: 1, status: 'on_track' }, 2, 'blocked', '  ')).toThrow();
    expect(answerEffect({ doneCount: 1, status: 'on_track' }, null, 'blocked', 'Chưa có ảnh sản phẩm')).toEqual({
      doneCount: 1,
      status: 'blocked',
      markDone: [],
      alert: { kind: 'blocker', reason: 'Chưa có ảnh sản phẩm' },
    });
  });
});

describe('dispatch plan', () => {
  const task = { id: 't', status: 'on_track' as const, dueAt: at('Fri', '17:30'), closedAs: null };
  const cp = (pct: number, scheduledAt: number, extra: Partial<Record<string, number | null>> = {}) => ({
    id: pct,
    taskId: 't',
    pct,
    scheduledAt,
    sentAt: null,
    answeredAt: null,
    expiredAt: null,
    noReplyAlertedAt: null,
    ...extra,
  });
  it('sends nothing outside working hours', () => {
    const plan = planDispatch({ now: at('Mon', '19:00'), cal, noReplyWindowHours: 2, tasks: [task], checkpoints: [cp(25, at('Mon', '10:00'))] });
    expect(plan.canSend).toBe(false);
    expect(plan.send).toEqual([]);
  });
  it('sends only the latest due checkpoint and expires older unsent ones', () => {
    const plan = planDispatch({
      now: at('Wed', '13:30'),
      cal,
      noReplyWindowHours: 2,
      tasks: [task],
      checkpoints: [cp(25, at('Tue', '10:00')), cp(50, at('Wed', '12:00')), cp(75, at('Thu', '15:30'))],
    });
    expect(plan.send.map((c) => c.pct)).toEqual([50]);
    expect(plan.expire.map((c) => c.pct)).toEqual([25]);
  });
  it('raises one no-reply alert per checkpoint only once', () => {
    const silent = cp(25, at('Mon', '09:00'), { sentAt: at('Mon', '09:00') });
    expect(planDispatch({ now: at('Mon', '10:59'), cal, noReplyWindowHours: 2, tasks: [task], checkpoints: [silent] }).noReply).toEqual([]);
    expect(planDispatch({ now: at('Mon', '11:00'), cal, noReplyWindowHours: 2, tasks: [task], checkpoints: [silent] }).noReply.length).toBe(1);
    const alerted = { ...silent, noReplyAlertedAt: at('Mon', '11:00') };
    expect(planDispatch({ now: at('Mon', '15:00'), cal, noReplyWindowHours: 2, tasks: [task], checkpoints: [alerted] }).noReply).toEqual([]);
    expect(noReplyDue(silent, at('Mon', '13:45'), 2, cal)).toBe(true);
  });
  it('counts silence in working hours (lunch does not count)', () => {
    const silent = cp(25, at('Mon', '11:00'), { sentAt: at('Mon', '11:00') });
    expect(noReplyDue(silent, at('Mon', '13:59'), 2, cal)).toBe(false);
    expect(noReplyDue(silent, at('Mon', '14:30'), 2, cal)).toBe(true);
  });
  it('expires remaining checkpoints of a finished task', () => {
    const plan = planDispatch({ now: at('Thu', '16:00'), cal, noReplyWindowHours: 2, tasks: [{ ...task, status: 'done' }], checkpoints: [cp(99, at('Fri', '17:06'))] });
    expect(plan.expire.length).toBe(1);
    expect(plan.send).toEqual([]);
  });
});

describe('closing and KPIs', () => {
  it('closes overdue when a milestone is missing or late', () => {
    expect(closeOutcome([1, 2, 3, null], 10)).toBe('overdue');
    expect(closeOutcome([1, 2, 3, 11], 10)).toBe('overdue');
  });
  it('computes weekly turnaround by local week', () => {
    const w = weeklyTurnaround(
      [
        { id: 'a', requestedAt: at('Mon', '08:00'), sentAt: at('Mon', '15:30') },
        { id: 'b', requestedAt: at('Fri', '08:00'), sentAt: at('NextMon', '12:00') },
      ],
      cal,
    );
    expect(w.map((p) => [p.weekStart, p.count, p.avgHours])).toEqual([
      ['2026-10-05', 1, 6],
      ['2026-10-12', 1, 12],
    ]);
    expect(localWeekStart(at('Sun', '23:00'), cal.timeZone)).toBe('2026-10-05');
  });
  it('groups turnaround by band result', () => {
    const g = turnaroundByBand([{ id: 'a', requestedAt: at('Mon', '08:00'), sentAt: at('Mon', '10:00'), bandResult: 'send_now' }], cal);
    expect(g.find((x) => x.level === 'send_now')?.avgHours).toBe(2);
    expect(g.find((x) => x.level === 'pm')?.avgHours).toBeNull();
  });
  it('measures response, early warning and overdue rates', () => {
    expect(checkpointResponseRate([
      { id: 1, taskId: 't', sentAt: 1, answeredAt: 2 },
      { id: 2, taskId: 't', sentAt: 1, answeredAt: null },
      { id: 3, taskId: 't', sentAt: null, answeredAt: null },
    ])).toEqual({ sent: 2, answered: 1, rate: 50 });
    const tasks = [
      { id: 'warned', dueAt: 100, closedAs: 'overdue' as const, status: 'overdue' },
      { id: 'silentLate', dueAt: 100, closedAs: 'overdue' as const, status: 'overdue' },
      { id: 'fine', dueAt: 100, closedAs: 'on_time' as const, status: 'done' },
      { id: 'riskButOk', dueAt: 100, closedAs: 'on_time' as const, status: 'done' },
    ];
    const alerts = [
      { taskId: 'warned', kind: 'at_risk' as const, createdAt: 50 },
      { taskId: 'warned', kind: 'overdue' as const, createdAt: 100 },
      { taskId: 'silentLate', kind: 'overdue' as const, createdAt: 100 },
      { taskId: 'riskButOk', kind: 'blocker' as const, createdAt: 60 },
    ];
    const ew = earlyWarningRate(tasks, alerts);
    expect([ew.risky, ew.early]).toEqual([3, 2]);
    expect(overdueRate(tasks)).toEqual({ closed: 4, overdue: 2, rate: 50 });
  });
  const jul6 = localToMs(2026, 7, 6, 8, 0, cal.timeZone); // Monday in the baseline period
  it('reports a baseline mismatch clearly', () => {
    const one = baselineCheck([{ id: 'a', requestedAt: jul6, sentAt: jul6 + 2 * 3_600_000 }], cal);
    expect(one.ran).toBe(true);
    expect(one.pass).toBe(false);
    expect(baselineCheck([], cal).ran).toBe(false);
  });
  it('builds a 19-quote set that reproduces the published baseline', () => {
    // 9 with a reference (avg 7.0 h, 2 late) + 10 recalculated (avg 10.15 h, 8 late)
    const hours = [4, 5, 6, 6.5, 7, 7.5, 8, 9.5, 9.5, 6, 7.5, 9, 9.5, 10, 11, 11.5, 12, 12.5, 12.5];
    const quotes = hours.map((h, i) => ({ id: String(i), requestedAt: jul6, sentAt: addWorkingHours(jul6, h, cal).getTime() }));
    const k = quoteKpis(quotes, cal);
    expect(k.count).toBe(19);
    expect(Math.round((k.avgHours as number) * 100) / 100).toBe(8.66);
    expect(k.lateCount).toBe(10);
    expect(baselineCheck(quotes, cal).pass).toBe(true);
    // Extra archive history outside 01/07–30/09/2026 does not change the check.
    const older = { id: 'old', requestedAt: localToMs(2026, 5, 4, 8, 0, cal.timeZone), sentAt: localToMs(2026, 5, 8, 17, 0, cal.timeZone) };
    const withOlder = baselineCheck([...quotes, older], cal);
    expect(withOlder.pass).toBe(true);
    expect(withOlder.skipped).toBe(1);
  });
});

describe('imports', () => {
  it('reads Vietnamese and ISO dates in local time', () => {
    expect(parseLocalDateTime('05/10/2026 08:00', cal.timeZone)).toBe(at('Mon', '08:00'));
    expect(parseLocalDateTime('2026-10-05 08:00', cal.timeZone)).toBe(at('Mon', '08:00'));
    expect(parseLocalDateTime('2026-10-05T01:00:00Z', cal.timeZone)).toBe(at('Mon', '08:00'));
    expect(parseLocalDateTime('31/02/2026 08:00', cal.timeZone)).toBeNull();
  });
  it('reads money and numbers in both styles', () => {
    expect(parseVnd('1.500.000')).toBe(1_500_000);
    expect(parseVnd('1,500,000 đ')).toBe(1_500_000);
    expect(parseVnd('1525000.5')).toBe(1_525_001);
    expect(parseVnd('abc')).toBeNull();
    expect(parseNumber('7,5%')).toBe(7.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('12')).toBe(12);
  });
  it('validates library rows', () => {
    const res = validateLibraryRows([
      { item_name: 'TikTok video', unit: 'video', group: 'Social Media', unit_price: '1.500.000' },
      { item_name: '', unit: 'x', group: 'g', unit_price: '1' },
      { item_name: 'TikTok video', unit: 'video', group: 'Social Media', unit_price: '1' },
    ]);
    expect(res.rows.length).toBe(1);
    expect(res.errors.map((e) => e.row)).toEqual([2, 3]);
  });
  it('groups quote history rows by quote code', () => {
    const res = validateQuoteHistoryRows(
      [
        { quote_code: 'H-01', client_alias: 'Khách A', service_group: 'Social Media', requested_at: '05/10/2026 08:00', sent_at: '05/10/2026 15:30', item_name: 'TikTok', unit: 'video', qty: '12', unit_price: '1500000', discount_pct: '5' },
        { quote_code: 'H-01', client_alias: 'Khách A', service_group: 'Social Media', requested_at: '05/10/2026 08:00', sent_at: '05/10/2026 15:30', item_name: 'FB post', unit: 'post', qty: '8', unit_price: '600000', discount_pct: '5' },
        { quote_code: 'H-02', client_alias: 'Khách B', service_group: 'Social Media', requested_at: '05/10/2026 08:00', sent_at: '04/10/2026 15:30', item_name: 'TikTok', unit: 'video', qty: '1', unit_price: '1', discount_pct: '0' },
      ],
      cal.timeZone,
    );
    expect(res.quotes.length).toBe(1);
    expect(res.quotes[0].lines.length).toBe(2);
    expect(res.errors.length).toBe(1);
  });
  it('validates task rows', () => {
    const res = validateTaskRows(
      [
        { task_name: 'Banner 11.11', owner_email: 'a@b.vn', task_type: 'Campaign banners', start_at: '05/10/2026 08:00', due_at: '09/10/2026 17:30' },
        { task_name: 'Bad', owner_email: 'a@b.vn', task_type: '', start_at: '05/10/2026 08:00', due_at: '04/10/2026 17:30' },
      ],
      cal.timeZone,
    );
    expect(res.rows.length).toBe(1);
    expect(res.errors[0].row).toBe(2);
  });
});

describe('small rules', async () => {
  const { statusAfterSilence, linesMissingOverrideReason } = await import('./index');
  it('marks silent tasks as no update unless blocked or closed', () => {
    expect(statusAfterSilence('on_track')).toBe('no_update');
    expect(statusAfterSilence('at_risk')).toBe('no_update');
    expect(statusAfterSilence('blocked')).toBe('blocked');
    expect(statusAfterSilence('done')).toBe('done');
  });
  it('requires a reason for price overrides', () => {
    expect(linesMissingOverrideReason([
      { unitPrice: 1, libraryPrice: 1 },
      { unitPrice: 2, libraryPrice: 1, overrideReason: ' ' },
      { unitPrice: 2, libraryPrice: 1, overrideReason: 'Khách VIP' },
    ])).toEqual([1]);
  });
});

describe('Vietnamese date labels', () => {
  it('echo a picked date in day/month order with the weekday', () => {
    const t = localToMs(2026, 10, 21, 10, 26, 'Asia/Ho_Chi_Minh');
    expect(fmtVnLong(t, 'Asia/Ho_Chi_Minh')).toBe('Thứ Tư 21/10/2026 10:26');
    expect(fmtVnShort(t, 'Asia/Ho_Chi_Minh')).toBe('T4 10:26, 21/10');
  });
});

describe('task draft', () => {
  const cal = DEFAULT_CALENDAR;
  const base = { name: 'Banner', ownerId: 'u1', milestones: ['a', 'b', 'c', 'd'] };
  const mon = localToMs(2026, 10, 5, 8, 0, cal.timeZone);
  const fri = localToMs(2026, 10, 9, 17, 30, cal.timeZone);
  it('accepts a running task whose deadline is still ahead', () => {
    expect(validateTaskDraft({ ...base, startAt: mon, dueAt: fri, now: localToMs(2026, 10, 7, 9, 0, cal.timeZone) }, cal)).toEqual([]);
  });
  it('refuses a deadline that has already passed (it would count as overdue at once)', () => {
    const errs = validateTaskDraft({ ...base, startAt: mon, dueAt: fri, now: localToMs(2026, 10, 12, 9, 0, cal.timeZone) }, cal);
    expect(errs.some((e) => e.startsWith('Deadline đã qua'))).toBe(true);
  });
});
