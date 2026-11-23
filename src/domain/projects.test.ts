import { describe, expect, it } from 'vitest';
import {
  applyExtension,
  autoTier,
  chatMatchesCode,
  checkinDates,
  checkinToSend,
  checkProjectCode,
  cleanLinks,
  evidenceErrors,
  extensionErrors,
  isNoUpdate,
  kpiStatus,
  kpiTracked,
  loadLevel,
  monthGrid,
  morningSummaryMessage,
  normalizeProjectCode,
  parseProjectCommand,
  projectRollup,
  reminderToday,
  reviewIsLate,
  summarizeProject,
  taskCode,
  taskHealth,
  weekOf,
  whyNot,
  workDaysAfter,
  eveningSummaryMessage,
  invitationErrors,
  inviteAnsweredMessage,
  taskDateErrors,
  personMonthStats,
  loadState,
  starOutlook,
  suggestQuality,
  type SummaryTask,
} from './projects';

const CAL = { workDays: [1, 2, 3, 4, 5], holidays: [] as string[] };
const TZ = 'Asia/Ho_Chi_Minh';
const at = (local: string) => Date.parse(`${local}+07:00`);

describe('codes (PRD 5.1, 6.1)', () => {
  it('normalises and checks project codes', () => {
    expect(normalizeProjectCode('mt 35')).toBe('MT35');
    expect(checkProjectCode('mt 35')).toEqual([]);
    expect(checkProjectCode('DA056')).toEqual([]);
    expect(checkProjectCode('M35')[0]).toMatch(/chưa đúng/);
    expect(checkProjectCode('MT35', ['mt35'])[0]).toMatch(/đã có/);
    expect(checkProjectCode('')[0]).toMatch(/Thiếu/);
  });
  it('builds task codes with two digits, three past 99', () => {
    expect(taskCode('MT35', 8)).toBe('MT35-08');
    expect(taskCode('mt35', 100)).toBe('MT35-100');
  });
  it('matches a Lark group by the project code', () => {
    expect(chatMatchesCode('MT35 · Ra mắt BST Tết', 'MT35')).toBe(true);
    expect(chatMatchesCode('Nhóm mt35', 'MT35')).toBe(true);
    expect(chatMatchesCode('MT350 khác', 'MT35')).toBe(false);
  });
});

describe('reminder tiers (PRD 7.1, AC 18–19)', () => {
  it('picks the tier from the duration', () => {
    expect(autoTier('2026-12-01', '2026-12-03')).toBe('short');
    expect(autoTier('2026-12-01', '2026-12-04')).toBe('short');
    expect(autoTier('2026-12-01', '2026-12-05')).toBe('medium');
    expect(autoTier('2026-12-01', '2026-12-08')).toBe('medium');
    expect(autoTier('2026-12-01', '2026-12-09')).toBe('long');
  });
  it('AC18: short task — no check-in, reminder on D0 only, overdue daily', () => {
    const t = { state: 'doing' as const, startDate: '2026-12-01', dueDate: '2026-12-03' };
    expect(checkinDates(t.startDate, t.dueDate, 'short', CAL)).toEqual([]);
    expect(reminderToday(t, '2026-12-01')).toBeNull();
    expect(reminderToday(t, '2026-12-02')).toBeNull();
    expect(reminderToday(t, '2026-12-03')).toMatchObject({ kind: 'due', label: 'D0' });
    expect(reminderToday(t, '2026-12-04')).toMatchObject({ kind: 'overdue', label: 'D+1' });
    expect(reminderToday(t, '2026-12-06')).toMatchObject({ kind: 'overdue', label: 'D+3' });
  });
  it('AC19: long task — check-ins 08/12 and 14/12 (75% falls on Saturday), reminders 13–15/12', () => {
    expect(checkinDates('2026-12-01', '2026-12-15', 'long', CAL)).toEqual([
      { pct: 50, date: '2026-12-08' },
      { pct: 75, date: '2026-12-14' },
    ]);
    const t = { state: 'doing' as const, startDate: '2026-12-01', dueDate: '2026-12-15' };
    expect(reminderToday(t, '2026-12-12')).toBeNull();
    expect(reminderToday(t, '2026-12-13')).toMatchObject({ label: 'D-2' });
    expect(reminderToday(t, '2026-12-14')).toMatchObject({ label: 'D-1' });
    expect(reminderToday(t, '2026-12-15')).toMatchObject({ label: 'D0' });
  });
  it('medium task: one check-in at 50%, D-1 and D0', () => {
    expect(checkinDates('2026-12-01', '2026-12-07', 'medium', CAL)).toEqual([{ pct: 50, date: '2026-12-04' }]);
    const t = { state: 'doing' as const, startDate: '2026-12-01', dueDate: '2026-12-07' };
    expect(reminderToday(t, '2026-12-05')).toBeNull();
    expect(reminderToday(t, '2026-12-06')).toMatchObject({ label: 'D-1' });
  });
  it('the PM can override the tier', () => {
    const t = { state: 'doing' as const, startDate: '2026-12-01', dueDate: '2026-12-03', tier: 'medium' as const };
    expect(reminderToday(t, '2026-12-02')).toMatchObject({ label: 'D-1' });
  });
  it('no reminders while waiting for the PM or once closed; "Cần sửa" gets D-1, D0, overdue', () => {
    const base = { startDate: '2026-12-01', dueDate: '2026-12-15' };
    expect(reminderToday({ ...base, state: 'review' }, '2026-12-16')).toBeNull();
    expect(reminderToday({ ...base, state: 'done' }, '2026-12-16')).toBeNull();
    expect(reminderToday({ ...base, state: 'cancelled' }, '2026-12-16')).toBeNull();
    expect(reminderToday({ ...base, state: 'changes' }, '2026-12-13')).toBeNull();
    expect(reminderToday({ ...base, state: 'changes' }, '2026-12-14')).toMatchObject({ label: 'D-1' });
  });
  it('sends the latest due check-in once, only on working days and while "Đang làm"', () => {
    const t = { state: 'doing' as const, startDate: '2026-12-01', dueDate: '2026-12-15' };
    expect(checkinToSend(t, [], '2026-12-07', CAL)).toBeNull();
    expect(checkinToSend(t, [], '2026-12-08', CAL)).toEqual({ pct: 50, date: '2026-12-08' });
    expect(checkinToSend(t, [50], '2026-12-09', CAL)).toBeNull();
    expect(checkinToSend(t, [50], '2026-12-12', CAL)).toBeNull(); // Saturday
    expect(checkinToSend(t, [], '2026-12-14', CAL)).toEqual({ pct: 75, date: '2026-12-14' });
    expect(checkinToSend({ ...t, state: 'changes' }, [], '2026-12-08', CAL)).toBeNull();
  });
  it('AC21: unanswered until 09:00 of the next working day → no update', () => {
    expect(isNoUpdate('2026-12-08', '2026-12-08', '17:00', CAL)).toBe(false);
    expect(isNoUpdate('2026-12-08', '2026-12-09', '08:59', CAL)).toBe(false);
    expect(isNoUpdate('2026-12-08', '2026-12-09', '09:00', CAL)).toBe(true);
    // Friday question → Monday 09:00
    expect(isNoUpdate('2026-12-11', '2026-12-12', '10:00', CAL)).toBe(false);
    expect(isNoUpdate('2026-12-11', '2026-12-14', '09:00', CAL)).toBe(true);
  });
  it('AC22: review nudge after more than one working day', () => {
    expect(workDaysAfter('2026-12-07', '2026-12-08', CAL)).toBe(1);
    expect(reviewIsLate('2026-12-07', '2026-12-08', CAL)).toBe(false);
    expect(reviewIsLate('2026-12-07', '2026-12-09', CAL)).toBe(true);
    expect(reviewIsLate('2026-12-11', '2026-12-14', CAL)).toBe(false);
  });
});

describe('lifecycle (PRD 6.3, AC 5, 11, 13)', () => {
  const staff = { role: 'staff', isAssignee: true, isProjectPm: false };
  const pm = { role: 'pm', isAssignee: false, isProjectPm: true };
  const otherPm = { role: 'pm', isAssignee: false, isProjectPm: false };
  const admin = { role: 'admin', isAssignee: false, isProjectPm: false };
  it('only the assignee submits; only the project PM reviews', () => {
    expect(whyNot('submit', 'doing', staff)).toBeNull();
    expect(whyNot('submit', 'changes', staff)).toBeNull();
    expect(whyNot('submit', 'review', staff)).toMatch(/Chờ duyệt/);
    expect(whyNot('submit', 'doing', pm)).toMatch(/người được giao/);
    expect(whyNot('approve', 'review', pm)).toBeNull();
    expect(whyNot('approve', 'review', otherPm)).toMatch(/PM phụ trách/);
    expect(whyNot('approve', 'doing', pm)).toMatch(/chưa được nộp/);
  });
  it('nobody, admin included, can complete a task on someone\'s behalf', () => {
    for (const a of ['submit', 'approve'] as const) expect(whyNot(a, 'doing', admin)).not.toBeNull();
    expect(whyNot('approve', 'review', admin)).not.toBeNull();
  });
  it('requires evidence and valid links', () => {
    expect(evidenceErrors({ links: [], files: [] })[0]).toMatch(/ít nhất 1/);
    expect(cleanLinks(['https://drive.google.com/x', 'not a link', 'https://drive.google.com/x'])).toEqual(['https://drive.google.com/x']);
    expect(evidenceErrors({ links: cleanLinks('https://a.vn/b'), files: [] })).toEqual([]);
  });
});

describe('extensions and KPI (PRD 6.4, 9.1, AC 14–16)', () => {
  it('AC14: "chưa đạt" keeps the KPI deadline → late if approved after it', () => {
    const t = applyExtension({ dueDate: '2026-12-10', kpiDueDate: '2026-12-10' }, '2026-12-14', 'quality');
    expect(t).toEqual({ dueDate: '2026-12-14', kpiDueDate: '2026-12-10' });
    expect(kpiStatus({ state: 'done', kpiDueDate: t.kpiDueDate, acceptedAt: at('2026-12-13T10:00:00'), pendingAt: null }, at('2026-12-15T10:00:00'), TZ)).toBe('late');
  });
  it('AC15: "yêu cầu thay đổi" moves the KPI deadline → on time', () => {
    const t = applyExtension({ dueDate: '2026-12-10', kpiDueDate: '2026-12-10' }, '2026-12-14', 'scope');
    expect(kpiStatus({ state: 'done', kpiDueDate: t.kpiDueDate, acceptedAt: at('2026-12-13T10:00:00'), pendingAt: null }, at('2026-12-15T10:00:00'), TZ)).toBe('on_time');
  });
  it('AC16: submitted before the deadline, approved two days after → on time', () => {
    const facts = { state: 'done' as const, kpiDueDate: '2026-12-10', acceptedAt: at('2026-12-10T16:00:00'), pendingAt: null };
    expect(kpiStatus(facts, at('2026-12-12T10:00:00'), TZ)).toBe('on_time');
  });
  it('an on-time submission waiting for review is not judged yet; a late one counts as overdue', () => {
    expect(kpiStatus({ state: 'review', kpiDueDate: '2026-12-10', acceptedAt: null, pendingAt: at('2026-12-09T10:00:00') }, at('2026-12-12T10:00:00'), TZ)).toBe('pending');
    expect(kpiStatus({ state: 'review', kpiDueDate: '2026-12-10', acceptedAt: null, pendingAt: at('2026-12-11T10:00:00') }, at('2026-12-12T10:00:00'), TZ)).toBe('overdue');
    expect(kpiTracked({ state: 'review', kpiDueDate: '2026-12-10', acceptedAt: null, pendingAt: at('2026-12-09T10:00:00') }, at('2026-12-12T10:00:00'), TZ)).toBeNull();
    expect(kpiTracked({ state: 'cancelled', kpiDueDate: '2026-12-10', acceptedAt: null, pendingAt: null }, at('2026-12-12T10:00:00'), TZ)).toBeNull();
    expect(kpiTracked({ state: 'doing', kpiDueDate: '2026-12-10', acceptedAt: null, pendingAt: null }, at('2026-12-12T10:00:00'), TZ)).toEqual({ dueDate: '2026-12-10', completedAt: null });
  });
  it('checks a new deadline against the project deadline', () => {
    expect(extensionErrors({ dueDate: '2026-12-10' }, '2026-12-20', 'scope', '2026-12-31', '2026-12-05')).toEqual([]);
    expect(extensionErrors({ dueDate: '2026-12-10' }, '2027-01-05', 'scope', '2026-12-31', '2026-12-05')[0]).toMatch(/sau deadline dự án/);
    expect(extensionErrors({ dueDate: '2026-12-10' }, '2026-12-20', null, '2026-12-31', '2026-12-05')[0]).toMatch(/lý do/);
  });
});

describe('health and project roll-up (PRD 5.4, 6.6)', () => {
  const base = { state: 'doing' as const, dueDate: '2026-12-10', progress: null, noUpdate: false, hasEvidence: false };
  it('takes the worst signal', () => {
    expect(taskHealth(base, '2026-12-05').health).toBe('green');
    expect(taskHealth({ ...base, progress: 'behind' }, '2026-12-05').health).toBe('amber');
    expect(taskHealth({ ...base, noUpdate: true }, '2026-12-05').health).toBe('amber');
    expect(taskHealth({ ...base, progress: 'blocked', progressNote: 'chờ logo' }, '2026-12-05')).toEqual({ health: 'red', reason: 'Bị chặn: chờ logo' });
    expect(taskHealth({ ...base, progress: 'on_plan' }, '2026-12-11')).toEqual({ health: 'red', reason: 'Quá hạn 1 ngày' });
    expect(taskHealth({ ...base, state: 'review', hasEvidence: true }, '2026-12-11').health).toBe('blue');
    expect(taskHealth({ ...base, state: 'review', hasEvidence: false }, '2026-12-11').health).toBe('amber');
    expect(taskHealth({ ...base, state: 'changes' }, '2026-12-09').health).toBe('amber');
    expect(taskHealth({ ...base, state: 'done' }, '2026-12-20').health).toBe('done');
  });
  const p = { state: 'active' as const, startDate: '2026-12-01', dueDate: '2026-12-11' };
  it('AC10: done when every live task is approved', () => {
    const r = projectRollup(p, [{ state: 'done', health: 'done' }, { state: 'cancelled', health: 'cancelled' }], '2026-12-05');
    expect(r).toMatchObject({ status: 'done', total: 1, done: 1, pct: 100 });
  });
  it('late, red, risk, ok in that order', () => {
    expect(projectRollup(p, [{ state: 'doing', health: 'green' }], '2026-12-12').status).toBe('late');
    expect(projectRollup(p, [{ state: 'doing', health: 'red' }, { state: 'doing', health: 'amber' }], '2026-12-05').status).toBe('red');
    expect(projectRollup(p, [{ state: 'doing', health: 'amber' }], '2026-12-05').status).toBe('risk');
    expect(projectRollup(p, [{ state: 'doing', health: 'green' }], '2026-12-02').status).toBe('ok');
  });
  it('risk when time runs ahead of approved tasks by more than 25 points', () => {
    const tasks = [{ state: 'done' as const, health: 'done' as const }, { state: 'doing' as const, health: 'green' as const }, { state: 'doing' as const, health: 'green' as const }];
    expect(projectRollup(p, tasks, '2026-12-05').status).toBe('ok'); // 40% time, 33% done
    const r = projectRollup(p, tasks, '2026-12-08'); // 70% time, 33% done
    expect(r.status).toBe('risk');
    expect(r.reason).toMatch(/70%/);
  });
  it('a project with no task is not done', () => {
    expect(projectRollup(p, [], '2026-12-02').status).toBe('ok');
    expect(projectRollup({ ...p, state: 'cancelled' }, [], '2026-12-02').status).toBe('cancelled');
  });
});

describe('summaries (PRD 7.6, AC 23–24)', () => {
  const T = (over: Partial<SummaryTask>): SummaryTask => ({ code: 'MT35-01', name: 'Task', state: 'doing', dueDate: '2026-12-10', health: 'green', reason: '', progress: null, noUpdate: false, reviewSince: null, submittedOn: null, approvedOn: null, ...over });
  const tasks = [
    T({ code: 'MT35-01', dueDate: '2026-12-08' }),
    T({ code: 'MT35-02', dueDate: '2026-12-09' }),
    T({ code: 'MT35-03', dueDate: '2026-12-10' }),
    T({ code: 'MT35-04', state: 'review', reviewSince: '2026-12-07', submittedOn: '2026-12-07' }),
    T({ code: 'MT35-05', dueDate: '2026-12-20', progress: 'blocked' }),
    T({ code: 'MT35-06', state: 'done', approvedOn: '2026-12-09' }),
  ];
  it('lists what needs the PM per project', () => {
    const s = summarizeProject({ code: 'MT35', name: 'Tết', status: 'red', reason: '' }, tasks, '2026-12-09', CAL);
    expect(s.overdue.map((t) => t.code)).toEqual(['MT35-01']);
    expect(s.dueToday.map((t) => t.code)).toEqual(['MT35-02']);
    expect(s.dueTomorrow.map((t) => t.code)).toEqual(['MT35-03']);
    expect(s.review).toMatchObject([{ code: 'MT35-04', waitDays: 2 }]);
    expect(s.blocked.map((t) => t.code)).toEqual(['MT35-05']);
    expect(s.approvedToday).toBe(1);
    expect(morningSummaryMessage([s], '2026-12-09').lines[0].text).toMatch(/1 quá hạn \(MT35-01\)/);
    const evening = eveningSummaryMessage([s], '2026-12-09');
    expect(evening.lines.find((l) => l.label?.startsWith('Đến hạn'))?.text).toMatch(/MT35-03/);
    expect(evening.lines.find((l) => l.label?.startsWith('Sẽ quá hạn'))?.text).toBe('MT35-02');
  });
});

describe('bot commands (PRD 10.1)', () => {
  const now = at('2026-12-01T10:00:00');
  it('reads /taomoi duan and /taomoi task', () => {
    expect(parseProjectCommand('/taomoi duan mt35 | Ra mắt BST Tết | 30/01/2027', [], now, TZ)).toEqual({ kind: 'project', code: 'MT35', name: 'Ra mắt BST Tết', dueDate: '2027-01-30', errors: [] });
    const t = parseProjectCommand('/taomoi task MT35 | Push KOC | @_user_1 | 20/12 | 50 video', [{ key: '@_user_1', openId: 'ou_1', name: 'Trâm' }], now, TZ);
    expect(t).toMatchObject({ kind: 'task', projectCode: 'MT35', name: 'Push KOC', assigneeOpenId: 'ou_1', dueDate: '2026-12-20', expectedOutput: '50 video', errors: [] });
  });
  it('still accepts the 1.5 forms', () => {
    expect(parseProjectCommand('/taomoi me DA056 | Quản lý KOC | @Trâm | 30/12/2026', [], now, TZ)).toMatchObject({ kind: 'project', code: 'DA056', dueDate: '2026-12-30' });
    expect(parseProjectCommand('/taomoi con DA056-04-S44 | Push | @Trâm | 20/12/2026', [], now, TZ)).toMatchObject({ kind: 'task', projectCode: 'DA056', legacy: true });
    expect(parseProjectCommand('xin chào', [], now, TZ)).toEqual({ kind: 'help' });
  });
});

describe('calendar helpers', () => {
  it('builds Monday-first month grids and weeks', () => {
    const g = monthGrid('2026-12');
    expect(g[0][0]).toBe('2026-11-30');
    expect(g[g.length - 1][6] >= '2026-12-31').toBe(true);
    expect(weekOf('2026-12-12')).toEqual(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13']);
    expect([0, 1, 2, 5].map(loadLevel)).toEqual([0, 1, 2, 3]);
  });
});

describe('task dates and invitations (23/11)', () => {
  const p = { startDate: '2026-12-01', dueDate: '2026-12-31' };
  it('a task cannot start before the project, nor end after it', () => {
    expect(taskDateErrors({ startDate: '2026-12-01', dueDate: '2026-12-10' }, p, '2026-11-25')).toEqual([]);
    expect(taskDateErrors({ startDate: '2026-11-30', dueDate: '2026-12-10' }, p, '2026-11-25')[0]).toMatch(/trước ngày bắt đầu dự án \(01\/12\/2026\)/);
    expect(taskDateErrors({ startDate: '2026-12-05', dueDate: '2027-01-02' }, p, '2026-11-25')[0]).toMatch(/sau deadline dự án/);
    expect(taskDateErrors({ startDate: '2026-12-05', dueDate: '2026-12-05' }, p, '2026-11-25')[0]).toMatch(/sau ngày bắt đầu/);
    expect(taskDateErrors({ startDate: '2026-12-05', dueDate: null }, p, '2026-11-25')).toEqual(['Thiếu deadline.']);
  });
  it('declining needs a reason that goes to the PM', () => {
    expect(invitationErrors(true, '')).toEqual([]);
    expect(invitationErrors(false, '  ')[0]).toMatch(/lý do/);
    expect(inviteAnsweredMessage({ code: 'MT35', name: 'Tết' }, 'Ngọc', false, 'Đang kín lịch').lines[1]).toMatchObject({ label: 'Lý do', text: 'Đang kín lịch' });
  });
});

describe('Go Star scoring facts (1.6.2)', () => {
  it('counts a person month by KPI deadline, rounds, extensions and check-ins', () => {
    const now = at('2026-11-23T10:00:00');
    const tasks = [
      { id: 'a', code: 'MT35-01', name: 'Brief', state: 'done' as const, kpiDueDate: '2026-11-05', acceptedAt: at('2026-11-04T09:00:00'), pendingAt: null },
      { id: 'b', code: 'MT35-02', name: 'Video', state: 'done' as const, kpiDueDate: '2026-11-10', acceptedAt: at('2026-11-12T09:00:00'), pendingAt: null },
      { id: 'c', code: 'MT35-03', name: 'Ads', state: 'doing' as const, kpiDueDate: '2026-11-20', acceptedAt: null, pendingAt: null },
      { id: 'd', code: 'MT35-04', name: 'Report', state: 'review' as const, kpiDueDate: '2026-11-28', acceptedAt: null, pendingAt: at('2026-11-22T09:00:00') },
      { id: 'e', code: 'MT35-05', name: 'Huỷ', state: 'cancelled' as const, kpiDueDate: '2026-11-15', acceptedAt: null, pendingAt: null },
      { id: 'f', code: 'MT35-06', name: 'Tháng sau', state: 'doing' as const, kpiDueDate: '2026-12-02', acceptedAt: null, pendingAt: null },
    ];
    const subs = [
      { task_id: 'a', decision: 'approved' as const },
      { task_id: 'b', decision: 'changes' as const },
      { task_id: 'b', decision: 'approved' as const },
      { task_id: 'd', decision: null },
    ];
    const exts = [
      { task_id: 'b', reason: 'quality' as const },
      { task_id: 'c', reason: 'scope' as const },
      { task_id: 'f', reason: 'scope' as const },
    ];
    const checkins = [
      { task_id: 'c', sent_at: '2026-11-15T02:00:00Z', answer: 'blocked' as const },
      { task_id: 'c', sent_at: '2026-11-18T02:00:00Z', answer: null },
      { task_id: 'd', sent_at: null, answer: null },
    ];
    const s = personMonthStats('2026-11', tasks, subs, exts, checkins, now, TZ);
    expect(s.total).toBe(4);
    expect([s.onTime, s.late, s.overdue, s.pending, s.open]).toEqual([1, 1, 1, 1, 0]);
    expect(s.firstPass).toBe(1);
    expect(s.sentBack).toBe(1);
    expect([s.extScope, s.extQuality]).toEqual([1, 1]);
    expect([s.asked, s.answered, s.blocked]).toEqual([2, 1, 1]);
    expect(s.tasks.map((t) => t.code)).toEqual(['MT35-01', 'MT35-02', 'MT35-03', 'MT35-04']);
    expect(s.tasks[1]).toMatchObject({ rounds: 2, sentBack: 1, extensions: 1, status: 'late' });
  });
});

describe('Trang Nhân sự (1.6.3)', () => {
  it('classifies workload', () => {
    expect(loadState({ open: 2, overdue: 1, blocked: 0, next7: 0 })).toBe('help');
    expect(loadState({ open: 2, overdue: 0, blocked: 1, next7: 0 })).toBe('help');
    expect(loadState({ open: 5, overdue: 0, blocked: 0, next7: 0 })).toBe('busy');
    expect(loadState({ open: 3, overdue: 0, blocked: 0, next7: 3 })).toBe('busy');
    expect(loadState({ open: 2, overdue: 0, blocked: 0, next7: 1 })).toBe('ok');
    expect(loadState({ open: 0, overdue: 0, blocked: 0, next7: 0 })).toBe('free');
  });
});

describe('Go Star gợi ý sao (1.6.4)', () => {
  const base = { tasks: [], total: 0, onTime: 0, late: 0, overdue: 0, open: 0, pending: 0, firstPass: 0, sentBack: 0, extScope: 0, extQuality: 0, asked: 0, answered: 0, behind: 0, blocked: 0 };
  it('suggests Work Quality from first-pass approvals', () => {
    expect(suggestQuality(base)).toBeNull();
    expect(suggestQuality({ ...base, onTime: 9, late: 1, firstPass: 9 })).toMatchObject({ score: 5, thin: false });
    expect(suggestQuality({ ...base, onTime: 4, firstPass: 3 })).toMatchObject({ score: 4 });
    expect(suggestQuality({ ...base, onTime: 2, firstPass: 1 })).toMatchObject({ score: 3, thin: true });
    expect(suggestQuality({ ...base, onTime: 4, firstPass: 0 })).toMatchObject({ score: 1 });
  });
  it('counts sure, likely and maximum stars', () => {
    const row = { stars: { completion: true, deadline: false, quality: false, kpi: false, teamwork: false }, score: { quality: null, kpiPct: null, teamwork: null } };
    const o = starOutlook(row, { ...base, onTime: 4, firstPass: 4 }, { qualityMinScore: 4 });
    expect(o.slots.map((x) => x.state)).toEqual(['on', 'off', 'likely', 'open', 'open']);
    expect([o.sure, o.likely, o.max]).toEqual([1, 2, 4]);
    const scored = starOutlook({ ...row, stars: { ...row.stars, teamwork: true }, score: { quality: null, kpiPct: 80, teamwork: 4 } }, null, { qualityMinScore: 4 });
    expect(scored.slots.map((x) => x.state)).toEqual(['on', 'off', 'open', 'off', 'on']);
    expect([scored.sure, scored.likely, scored.max]).toEqual([2, 2, 3]);
  });
});
