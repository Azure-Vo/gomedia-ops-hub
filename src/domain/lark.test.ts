import { describe, expect, it } from 'vitest';
import {
  checkChildCode,
  checkParentCode,
  completionCheck,
  daysUntil,
  decideLarkAction,
  DEFAULT_LARK_CODE_RULES,
  DraftContext,
  findCodeInTitle,
  larkDueStatus,
  larkLateStats,
  larkPeriodKpis,
  LarkTracked,
  larkTitle,
  milestoneFor,
  normalizeCode,
  parseCreateCommand,
  parseDueDate,
  reminderMessage,
  completionMessage,
  toLarkCard,
  validateCodeRules,
  validateDraft,
  stripCodeFromTitle,
} from './index';

const TZ = 'Asia/Ho_Chi_Minh';
// 10/11/2026 09:00 in Đà Nẵng
const NOW = Date.parse('2026-11-10T02:00:00Z');
const R = DEFAULT_LARK_CODE_RULES;

const task = (over: Partial<LarkTracked> = {}): LarkTracked => ({
  parentCode: 'DA056',
  parentName: '[STING] Quản lý 1600 KOC video Freecast',
  childCode: 'DA056-04-S44',
  childName: '[STING] Push 50 KOC gửi đủ số lượng video',
  assigneeOpenId: 'ou_tram',
  assigneeName: 'Nguyễn Thị Ngọc Trâm',
  dueDate: '2026-11-13',
  completedAt: null,
  ...over,
});
const act = (t: LarkTracked, sentToday = false, notifyD0 = false) =>
  decideLarkAction(t, NOW, TZ, { sentToday, schedule: { notifyD0, before: [3, 2, 1] } });

describe('S1 Lark · codes (brief 2.3)', () => {
  it('accepts the example codes and refuses broken ones', () => {
    expect(checkParentCode('DA056')).toEqual([]);
    expect(checkParentCode(' da056 ')).toEqual([]);
    expect(checkParentCode('DA56')[0]).toMatch(/sai format/);
    expect(checkParentCode('')[0]).toMatch(/Thiếu/);
    expect(checkChildCode('DA056-04-S44', 'DA056')).toEqual([]);
    expect(checkChildCode('DA056–04–S44', 'DA056')).toEqual([]); // typographic dashes
    expect(checkChildCode('DA056-4-S44', 'DA056')[0]).toMatch(/sai format/);
    expect(checkChildCode('DA056-04', 'DA056')[0]).toMatch(/sai format/);
    expect(checkChildCode('DA057-04-S44', 'DA056')[0]).toMatch(/không thuộc task mẹ DA056/);
    expect(normalizeCode(' da056 - 04 - s44 ')).toBe('DA056-04-S44');
  });
  it('rules can be changed and are checked against their own examples', () => {
    expect(validateCodeRules(R)).toEqual([]);
    expect(validateCodeRules({ ...R, childPattern: '^\\d{2}$' })[0]).toMatch(/\{PARENT\}/);
    expect(validateCodeRules({ ...R, parentExample: 'D56' })[0]).toMatch(/không khớp/);
    const custom = { parentPattern: '^[A-Z]{3}\\d{2}$', childPattern: '^{PARENT}\\.\\d{3}$', parentExample: 'ABC12', childExample: 'ABC12.001' };
    expect(validateCodeRules(custom)).toEqual([]);
    expect(checkChildCode('ABC12.001', 'ABC12', custom)).toEqual([]);
  });
  it('finds codes in Lark titles written like the CEO sample', () => {
    expect(findCodeInTitle('[DA056] [STING] Quản lý 1600 KOC video Freecast', 'parent')).toBe('DA056');
    expect(findCodeInTitle('[STING] Push 50 KOC gửi đủ số lượng video (DA056-04-S44)', 'child')).toBe('DA056-04-S44');
    expect(findCodeInTitle('Push 50 KOC (DA056-4-S44)', 'child')).toBeNull();
    expect(larkTitle('parent', 'DA056', 'Quản lý KOC')).toBe('[DA056] Quản lý KOC');
    expect(larkTitle('child', 'DA056-04-S44', 'Push KOC')).toBe('Push KOC (DA056-04-S44)');
    expect(stripCodeFromTitle('Push KOC (DA056-04-S44)', 'DA056-04-S44')).toBe('Push KOC');
  });
});

describe('S1 Lark · creating (brief step 8, cases 1–5)', () => {
  const ctx: DraftContext = { rules: R, now: NOW, timeZone: TZ, existingCodes: new Set(['DA001']), parents: new Map([['DA056', { dueDate: '2026-11-30' }]]) };
  const base = { name: 'Tên', assigneeOpenId: 'ou_x', assigneeName: 'X', dueDate: '2026-11-20' };
  it('1. parent with a valid code → allowed', () => expect(validateDraft({ kind: 'parent', code: 'DA057', ...base }, ctx)).toEqual([]));
  it('2. parent with a wrong code → error, nothing created', () => expect(validateDraft({ kind: 'parent', code: 'D-57', ...base }, ctx)[0]).toMatch(/sai format/));
  it('3. sub-task with a valid code → allowed', () => expect(validateDraft({ kind: 'child', code: 'DA056-04-S44', ...base }, ctx)).toEqual([]));
  it('4. sub-task with a wrong code → error', () => expect(validateDraft({ kind: 'child', code: 'DA056-4-S44', ...base }, ctx)[0]).toMatch(/sai format/));
  it('5. sub-task linked to a wrong / missing parent → refused', () => {
    expect(validateDraft({ kind: 'child', code: 'DA056-04-S44', parentCode: 'DA057', ...base }, ctx)[0]).toMatch(/không thuộc task mẹ DA057/);
    expect(validateDraft({ kind: 'child', code: 'DA099-04-S44', ...base }, ctx)[0]).toMatch(/Chưa có task mẹ DA099/);
  });
  it('also refuses duplicates, missing fields, past deadlines and a sub-task due after its parent', () => {
    expect(validateDraft({ kind: 'parent', code: 'DA001', ...base }, ctx).join()).toMatch(/đã có/);
    expect(validateDraft({ kind: 'parent', code: 'DA058', name: ' ', assigneeOpenId: null, assigneeName: null, dueDate: null }, ctx)).toHaveLength(3);
    expect(validateDraft({ kind: 'parent', code: 'DA058', ...base, dueDate: '2026-11-09' }, ctx)[0]).toMatch(/đã qua/);
    expect(validateDraft({ kind: 'child', code: 'DA056-04-S44', ...base, dueDate: '2026-12-05' }, ctx)[0]).toMatch(/sau deadline tổng/);
  });
  it('reads the chat command, with the real Lark account behind @mention', () => {
    const p = parseCreateCommand('/taomoi con DA056-04-S44 | Push 50 KOC | @_user_1 | 20/11 | gửi đủ video', [{ key: '@_user_1', openId: 'ou_tram', name: 'Trâm' }], NOW, TZ);
    expect(p.draft).toMatchObject({ kind: 'child', code: 'DA056-04-S44', name: 'Push 50 KOC', assigneeOpenId: 'ou_tram', dueDate: '2026-11-20', description: 'gửi đủ video' });
    expect(parseCreateCommand('xin chào', [], NOW, TZ).help).toBe(true);
    expect(parseCreateCommand('/taomoi me DA056 | Tên', [], NOW, TZ).errors[0]).toMatch(/Thiếu thông tin/);
    expect(parseDueDate('2026-02-30', NOW, TZ)).toBeNull();
    expect(parseDueDate('05/01', NOW, TZ)).toBe('2027-01-05');
  });
});

describe('S1 Lark · reminders (brief step 8, cases 6–17)', () => {
  it('counts calendar days in Vietnam time', () => {
    expect(daysUntil('2026-11-13', NOW, TZ)).toBe(3);
    expect(daysUntil('2026-11-10', Date.parse('2026-11-09T17:30:00Z'), TZ)).toBe(0); // 00:30 on the 10th in VN
    expect(daysUntil('2026-11-08', NOW, TZ)).toBe(-2);
  });
  it('6–8. three, two and one day before → D-3, D-2, D-1', () => {
    for (const [due, label] of [['2026-11-13', 'D-3'], ['2026-11-12', 'D-2'], ['2026-11-11', 'D-1']]) {
      const a = act(task({ dueDate: due }));
      expect(a.type === 'remind' && a.milestone.label).toBe(label);
    }
    expect(act(task({ dueDate: '2026-11-14' }))).toEqual({ type: 'none', reason: 'no_milestone' });
  });
  it('9. on the deadline day → nothing (unless Admin turns D0 on)', () => {
    expect(act(task({ dueDate: '2026-11-10' }))).toEqual({ type: 'none', reason: 'no_milestone' });
    const on = act(task({ dueDate: '2026-11-10' }), false, true);
    expect(on.type === 'remind' && on.milestone.label).toBe('D0');
  });
  it('10–12. one, two, ten days late → D+1, D+2, and every day after', () => {
    for (const [due, label] of [['2026-11-09', 'D+1'], ['2026-11-08', 'D+2'], ['2026-10-31', 'D+10']]) {
      const a = act(task({ dueDate: due }));
      expect(a.type === 'remind' && a.milestone.label).toBe(label);
    }
    expect(milestoneFor(-30)?.label).toBe('D+30');
  });
  it('one message per task per day', () => expect(act(task({ dueDate: '2026-11-09' }), true)).toEqual({ type: 'none', reason: 'already_sent' }));
  it('13. valid codes, not Completed → keep following', () => expect(act(task({ dueDate: '2026-11-09' })).type).toBe('remind'));
  it('14. valid codes and Completed → stop (send the completion card once)', () => {
    expect(act(task({ completedAt: NOW }))).toEqual({ type: 'complete' });
    expect(act(task({ completedAt: NOW, closedAt: NOW }))).toEqual({ type: 'none', reason: 'closed' });
  });
  it('Completed but the code was broken on Lark → keep reminding, with the problem on the card', () => {
    const a = act(task({ dueDate: '2026-11-09', completedAt: NOW, childCode: 'DA056-4-S44' }));
    expect(a.type).toBe('remind');
    if (a.type === 'remind') {
      expect(a.codeErrors[0]).toMatch(/sai format/);
      expect(reminderMessage(task(), a.milestone, a.codeErrors).lines.at(-1)?.text).toMatch(/Sửa mã/);
    }
    expect(completionCheck({ parentCode: 'DA056', childCode: 'DA056-04-S44', completedAt: null }).done).toBe(false);
  });
  it('15–16. a new deadline or a new assignee is used on the next run', () => {
    const moved = act(task({ dueDate: '2026-11-12' }));
    expect(moved.type === 'remind' && moved.milestone.label).toBe('D-2');
    const ms = milestoneFor(-1)!;
    expect(reminderMessage(task({ assigneeOpenId: 'ou_new', assigneeName: 'Người mới' }), ms).lines[2].mentionOpenId).toBe('ou_new');
  });
});

describe('S1 Lark · CEO card layout', () => {
  it('overdue card: red title, task lines, real @mention, deadline, D+n note', () => {
    const m = reminderMessage(task({ dueDate: '2026-11-09' }), milestoneFor(-1)!);
    expect(m.title).toBe('🔴 Task con đã đến hạn – Chưa hoàn thành!');
    expect(m.tone).toBe('red');
    expect(m.lines.map((l) => l.label ?? l.text)).toEqual(['Task mẹ', 'Task con', 'Người thực hiện', 'Hạn chót', 'Đã quá hạn 1 ngày.']);
    expect(m.lines[0].text).toBe('[DA056] [STING] Quản lý 1600 KOC video Freecast');
    expect(m.lines[1].text).toBe('[STING] Push 50 KOC gửi đủ số lượng video (DA056-04-S44)');
    const card = toLarkCard(m) as { header: { template: string }; elements: { text?: { content: string } }[] };
    expect(card.header.template).toBe('red');
    expect(card.elements[0].text?.content).toContain('<at id=ou_tram></at>');
    expect(card.elements[0].text?.content).toContain('⏰ **Hạn chót:** 09/11/2026');
  });
  it('before-deadline card is orange and says how many days are left', () => {
    const m = reminderMessage(task(), milestoneFor(3)!);
    expect([m.tone, m.title, m.badge]).toEqual(['orange', '🔴 Task sắp đến hạn – Còn 3 ngày!', 'D-3']);
  });
  it('completion card', () => {
    const m = completionMessage({ childCode: 'DA056-04-S44', completedAt: Date.parse('2026-10-20T03:30:00Z') }, TZ);
    expect(m.lines.map((l) => l.text)).toEqual(['Task: [DA056-04-S44] – DONE', 'Thời gian hoàn thành: 20/10/2026']);
  });
  it('late share for M1', () => {
    const s = larkLateStats(
      [
        { dueDate: '2026-11-05', completedAt: Date.parse('2026-11-05T09:00:00Z') },
        { dueDate: '2026-11-05', completedAt: Date.parse('2026-11-06T09:00:00Z') },
        { dueDate: '2026-11-08', completedAt: null },
        { dueDate: '2026-11-20', completedAt: null },
      ],
      NOW,
      TZ,
    );
    expect(s).toMatchObject({ onTime: 1, late: 1, openLate: 1, open: 1, latePct: 66.7 });
  });

  it('period KPIs for the dashboard: M1 over sub-tasks due in the range, reminders sent in it', () => {
    const now = Date.parse('2026-11-12T03:00:00Z'); // 10:00 in Vietnam
    const at = (d: string) => Date.parse(`${d}T03:00:00Z`);
    const tasks = [
      { id: 'a', dueDate: '2026-11-03', completedAt: at('2026-11-03') }, // on time
      { id: 'b', dueDate: '2026-11-05', completedAt: at('2026-11-07') }, // late
      { id: 'c', dueDate: '2026-11-06', completedAt: null }, // overdue
      { id: 'd', dueDate: '2026-11-20', completedAt: null }, // not due yet
      { id: 'e', dueDate: '2026-10-20', completedAt: at('2026-10-19') }, // outside the range
    ];
    const notes = [
      { taskId: 'c', localDate: '2026-11-07', kind: 'reminder' as const, status: 'simulated' as const },
      { taskId: 'c', localDate: '2026-11-08', kind: 'reminder' as const, status: 'sent' as const },
      { taskId: 'b', localDate: '2026-11-07', kind: 'completion' as const, status: 'sent' as const },
      { taskId: 'c', localDate: '2026-11-09', kind: 'reminder' as const, status: 'failed' as const },
      { taskId: 'e', localDate: '2026-10-18', kind: 'reminder' as const, status: 'sent' as const },
    ];
    const k = larkPeriodKpis(tasks, notes, '2026-11-01', '2026-11-30', now, TZ);
    expect(k).toMatchObject({ total: 4, onTime: 1, late: 1, openLate: 1, open: 1, judged: 3, latePct: 66.7, reminders: 2, remindedTasks: 1, completions: 1, failed: 1 });
    expect(larkDueStatus(tasks[1], now, TZ)).toBe('late');
    expect(larkDueStatus(tasks[2], now, TZ)).toBe('overdue');
    expect(larkDueStatus(tasks[3], now, TZ)).toBe('open');
  });
});
