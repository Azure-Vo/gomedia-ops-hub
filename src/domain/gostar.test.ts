import { describe, expect, it } from 'vitest';
import { employeeOfMonth, goStarMessage, monthEnd, monthIsOver, rankGoStar, starsFor, tallyTasks, GoStarScore, GoStarTask } from './gostar';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (d: string) => Date.parse(`${d}T10:00:00+07:00`);
const NOW = at('2026-11-11');

describe('Go Star · tasks from Lark', () => {
  const tasks: GoStarTask[] = [
    { assigneeOpenId: 'a', dueDate: '2026-11-03', completedAt: at('2026-11-03') }, // on time
    { assigneeOpenId: 'a', dueDate: '2026-11-05', completedAt: at('2026-11-06') }, // late
    { assigneeOpenId: 'a', dueDate: '2026-11-08', completedAt: null }, // overdue, open
    { assigneeOpenId: 'a', dueDate: '2026-11-20', completedAt: null }, // not yet due
    { assigneeOpenId: 'a', dueDate: '2026-10-30', completedAt: at('2026-10-29') }, // other month
  ];
  it('counts only sub-tasks due in the month, and judges only what is done or past due', () => {
    const t = tallyTasks(tasks, '2026-11', NOW, TZ);
    expect(t).toMatchObject({ judged: 3, done: 2, onTime: 1, late: 1, openLate: 1, notYetDue: 1 });
    expect(t.completionPct).toBe(66.7);
    expect(t.latePct).toBe(66.7);
  });
  it('a task due today and still open is not late yet', () => {
    const t = tallyTasks([{ assigneeOpenId: 'a', dueDate: '2026-11-11', completedAt: null }], '2026-11', NOW, TZ);
    expect(t.judged).toBe(0);
    expect(t.completionPct).toBeNull();
  });
});

describe('Go Star · stars', () => {
  const full = { judged: 5, done: 5, onTime: 5, late: 0, openLate: 0, notYetDue: 0, completionPct: 100, latePct: 0 };
  it('5 stars when every bar is met', () => {
    const s = starsFor(full, { kpiPct: 100, quality: 4, teamwork: 4 });
    expect(Object.values(s).every(Boolean)).toBe(true);
  });
  it('late rate must stay below 20% (the M1 bar); missing scores give no star', () => {
    const s = starsFor({ ...full, onTime: 4, late: 1, latePct: 20 }, { kpiPct: 99, quality: null, teamwork: 3 });
    expect(s).toEqual({ completion: true, deadline: false, quality: false, kpi: false, teamwork: false });
  });
  it('no judged task means no Lark stars', () => {
    const s = starsFor({ ...full, judged: 0, done: 0, onTime: 0, completionPct: null, latePct: null }, { kpiPct: 120, quality: 5, teamwork: 5 });
    expect(s.completion || s.deadline).toBe(false);
  });
});

describe('Go Star · ranking and prizes', () => {
  const people = ['An', 'Bình', 'Chi', 'Dũng', 'Em'].map((name, i) => ({ openId: `p${i}`, name }));
  const tasks: GoStarTask[] = people.map((p) => ({ assigneeOpenId: p.openId, dueDate: '2026-10-20', completedAt: at('2026-10-19') }));
  const after = at('2026-11-02');
  it('ranks by stars, then KPI, then quality, then teamwork; prizes 1M / 500k / 200k', () => {
    const scores = new Map<string, GoStarScore>([
      ['p0', { kpiPct: 105, quality: 4, teamwork: 4 }], // 5 stars
      ['p1', { kpiPct: 110, quality: 5, teamwork: 3 }], // 4 stars
      ['p2', { kpiPct: 110, quality: 4, teamwork: 3 }], // 4 stars, lower quality
      ['p3', { kpiPct: 90, quality: 3, teamwork: 3 }], // 2 stars
    ]);
    const rows = rankGoStar(people, tasks, scores, '2026-10', after, TZ);
    expect(rows.map((r) => [r.name, r.starCount, r.rank, r.prize])).toEqual([
      ['An', 5, 1, 1_000_000],
      ['Bình', 4, 2, 500_000],
      ['Chi', 4, 3, 200_000],
      ['Dũng', 2, 4, 0],
      ['Em', 2, 5, 0], // same 2 Lark stars, but no KPI entered sorts after a KPI of 90%
    ]);
    expect(employeeOfMonth(rows).map((r) => r.name)).toEqual(['An']);
    const msg = goStarMessage('2026-10', rows, (v) => `${v}`);
    expect(msg.title).toContain('Tháng 10/2026');
    expect(msg.lines[0]).toMatchObject({ label: 'Employee of the Month', text: 'An', mentionOpenId: 'p0' });
    expect(msg.lines).toHaveLength(4);
  });
  it('a full tie shares the rank and splits the prizes of the places it covers', () => {
    const same = { kpiPct: 100, quality: 4, teamwork: 4 };
    const scores = new Map<string, GoStarScore>(people.slice(0, 2).map((p) => [p.openId, same]));
    const rows = rankGoStar(people, tasks, scores, '2026-10', after, TZ);
    expect(rows.slice(0, 2).map((r) => [r.rank, r.tied, r.prize])).toEqual([
      [1, true, 750_000],
      [1, true, 750_000],
    ]);
    // Chi, Dũng and Em have the same 2 Lark stars and no scores: a three-way tie for 3rd shares 200k.
    expect(rows.slice(2).map((r) => [r.rank, r.prize])).toEqual([
      [3, 66_667],
      [3, 66_667],
      [3, 66_667],
    ]);
    expect(employeeOfMonth(rows)).toHaveLength(2);
  });
  it('nobody with 0 stars is paid', () => {
    const rows = rankGoStar(people.slice(0, 1), [], new Map(), '2026-10', after, TZ);
    expect(rows[0]).toMatchObject({ rank: 1, starCount: 0, prize: 0 });
    expect(employeeOfMonth(rows)).toHaveLength(0);
  });
});

describe('Go Star · month', () => {
  it('a month closes after its last day', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthIsOver('2026-10', NOW, TZ)).toBe(true);
    expect(monthIsOver('2026-11', NOW, TZ)).toBe(false);
  });
});
