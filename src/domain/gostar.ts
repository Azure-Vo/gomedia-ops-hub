// Go Star (1.4): monthly staff recognition next to S1. Five criteria, one star each per month:
// two are counted from the Lark sub-tasks (Task Completion, Deadline), three come from the
// manager's monthly scores (Work Quality, KPI Achievement, Teamwork). Ranking: stars, then KPI %,
// then quality score, then teamwork score. Pure rules: the page and the tests both use these.
import { localDateKey } from './time';
import type { BotMessage } from './lark';

export type GoStarCriterion = 'completion' | 'deadline' | 'quality' | 'kpi' | 'teamwork';

export const GOSTAR_CRITERIA: { key: GoStarCriterion; name: string; label: string; source: 'lark' | 'manager' }[] = [
  { key: 'completion', name: 'Task Completion', label: 'Hoàn thành công việc được giao', source: 'lark' },
  { key: 'deadline', name: 'Deadline', label: 'Đảm bảo tiến độ, đúng hạn', source: 'lark' },
  { key: 'quality', name: 'Work Quality', label: 'Đảm bảo chất lượng đầu ra', source: 'manager' },
  { key: 'kpi', name: 'KPI Achievement', label: 'Đạt KPI cá nhân', source: 'manager' },
  { key: 'teamwork', name: 'Teamwork', label: 'Chủ động hỗ trợ, phối hợp với đồng đội', source: 'manager' },
];

/** Thresholds (assumptions until the CEO confirms them). */
export interface GoStarRules {
  /** Share of judged sub-tasks that must be Completed (late or not). */
  completionMinPct: number;
  /** Late rate must stay below this, the same bar as S1's M1 target. */
  deadlineMaxLatePct: number;
  /** Manager scores are 1–5. */
  qualityMinScore: number;
  teamworkMinScore: number;
  /** Individual KPI achieved, in %. */
  kpiMinPct: number;
  /** Prize for rank 1, 2, 3 (VND). */
  prizes: number[];
}

export const DEFAULT_GOSTAR_RULES: GoStarRules = {
  completionMinPct: 100,
  deadlineMaxLatePct: 20,
  qualityMinScore: 4,
  teamworkMinScore: 4,
  kpiMinPct: 100,
  prizes: [1_000_000, 500_000, 200_000],
};

export interface GoStarTask {
  assigneeOpenId: string | null;
  dueDate: string; // YYYY-MM-DD
  /** Completed on Lark with valid codes (S1 "Hoàn thành"); null otherwise. */
  completedAt: number | null;
}

export interface GoStarScore {
  kpiPct: number | null;
  quality: number | null;
  teamwork: number | null;
}

export interface GoStarPerson {
  openId: string;
  name: string;
}

export interface TaskTally {
  /** Sub-tasks due in the month that can be judged now: done, or past their due date. */
  judged: number;
  done: number;
  onTime: number;
  late: number;
  openLate: number;
  /** Due later in the month and not done yet: not judged until then. */
  notYetDue: number;
  completionPct: number | null;
  latePct: number | null;
}

export interface GoStarRow {
  openId: string;
  name: string;
  tally: TaskTally;
  score: GoStarScore;
  stars: Record<GoStarCriterion, boolean>;
  starCount: number;
  /** 1-based; people tied on every rule share a rank. */
  rank: number;
  tied: boolean;
  prize: number;
}

export function monthKey(t: number, timeZone: string): string {
  return localDateKey(t, timeZone).slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `Tháng ${Number(m)}/${y}`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/** A month can be closed (finalised) once its last day has passed. */
export function monthIsOver(month: string, now: number, timeZone: string): boolean {
  return localDateKey(now, timeZone) > monthEnd(month);
}

export function tallyTasks(tasks: GoStarTask[], month: string, now: number, timeZone: string): TaskTally {
  const today = localDateKey(now, timeZone);
  let onTime = 0,
    late = 0,
    openLate = 0,
    notYetDue = 0;
  for (const t of tasks) {
    if (t.dueDate.slice(0, 7) !== month) continue;
    if (t.completedAt !== null) {
      if (localDateKey(t.completedAt, timeZone) <= t.dueDate) onTime++;
      else late++;
    } else if (t.dueDate < today) openLate++;
    else notYetDue++;
  }
  const done = onTime + late;
  const judged = done + openLate;
  const pct = (n: number) => (judged ? Math.round((n / judged) * 1000) / 10 : null);
  return { judged, done, onTime, late, openLate, notYetDue, completionPct: pct(done), latePct: pct(late + openLate) };
}

export function starsFor(tally: TaskTally, score: GoStarScore, rules: GoStarRules = DEFAULT_GOSTAR_RULES): Record<GoStarCriterion, boolean> {
  return {
    completion: tally.completionPct !== null && tally.completionPct >= rules.completionMinPct,
    deadline: tally.latePct !== null && tally.latePct < rules.deadlineMaxLatePct,
    quality: score.quality !== null && score.quality >= rules.qualityMinScore,
    kpi: score.kpiPct !== null && score.kpiPct >= rules.kpiMinPct,
    teamwork: score.teamwork !== null && score.teamwork >= rules.teamworkMinScore,
  };
}

const n = (v: number | null) => (v === null ? -1 : v);

/** Stars first; tie-break by KPI %, then Work Quality, then Teamwork (contribution). */
export function compareRows(a: Pick<GoStarRow, 'starCount' | 'score'>, b: Pick<GoStarRow, 'starCount' | 'score'>): number {
  return b.starCount - a.starCount || n(b.score.kpiPct) - n(a.score.kpiPct) || n(b.score.quality) - n(a.score.quality) || n(b.score.teamwork) - n(a.score.teamwork);
}

export function rankGoStar(
  people: GoStarPerson[],
  tasks: GoStarTask[],
  scores: Map<string, GoStarScore>,
  month: string,
  now: number,
  timeZone: string,
  rules: GoStarRules = DEFAULT_GOSTAR_RULES,
): GoStarRow[] {
  const rows = people.map((p) => {
    const tally = tallyTasks(
      tasks.filter((t) => t.assigneeOpenId === p.openId),
      month,
      now,
      timeZone,
    );
    const score = scores.get(p.openId) ?? { kpiPct: null, quality: null, teamwork: null };
    const stars = starsFor(tally, score, rules);
    const starCount = Object.values(stars).filter(Boolean).length;
    return { openId: p.openId, name: p.name, tally, score, stars, starCount, rank: 0, tied: false, prize: 0 };
  });
  rows.sort((a, b) => compareRows(a, b) || a.name.localeCompare(b.name, 'vi'));
  // Ties share the rank; a tie across prize places splits those prizes equally.
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && compareRows(rows[i], rows[j]) === 0) j++;
    const places = rules.prizes.slice(i, j);
    const pot = places.reduce((s, v) => s + v, 0);
    for (let k = i; k < j; k++) {
      rows[k].rank = i + 1;
      rows[k].tied = j - i > 1;
      rows[k].prize = rows[k].starCount > 0 && pot ? Math.round(pot / (j - i)) : 0;
    }
    i = j;
  }
  return rows;
}

/** Rank-1 people with at least one star; more than one means the CEO has to decide. */
export function employeeOfMonth(rows: GoStarRow[]): GoStarRow[] {
  return rows.filter((r) => r.rank === 1 && r.starCount > 0);
}

const MEDAL = ['🥇', '🥈', '🥉'];

/** The card the bot posts in the Lark group when the CEO closes the month. */
export function goStarMessage(month: string, rows: GoStarRow[], fmtMoney: (v: number) => string): BotMessage {
  const eom = employeeOfMonth(rows);
  const lines: BotMessage['lines'] = [];
  if (eom.length === 1) lines.push({ icon: '🏆', label: 'Employee of the Month', text: eom[0].name, mentionOpenId: eom[0].openId });
  for (const r of rows.filter((x) => x.prize > 0)) {
    lines.push({ icon: MEDAL[r.rank - 1] ?? '⭐', text: `Hạng ${r.rank}${r.tied ? ' (đồng hạng)' : ''}: ${r.name} · ${r.starCount}/5 ⭐ · thưởng ${fmtMoney(r.prize)}` });
  }
  return {
    tone: 'green',
    title: `🌟 Go Star ${monthLabel(month)} – Vinh danh nhân viên`,
    lines,
    note: 'Cảm ơn cả team đã nỗ lực trong tháng!',
    badge: 'Go Star',
  };
}
