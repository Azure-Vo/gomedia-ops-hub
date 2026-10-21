// KPI functions: every dashboard figure is computed here from stored timestamps.
import type { BandLevel } from './band';
import { WorkCalendar, workingHoursBetween } from './calendar';
import { localWeekStart } from './time';
import type { AlertKind } from './tasks';

export const QUOTE_LATE_HOURS = 8;

export interface QuoteForKpi {
  id: string;
  requestedAt: number;
  sentAt: number | null;
  bandResult?: BandLevel | null;
}

export interface QuoteKpiRow extends QuoteForKpi {
  hours: number;
  late: boolean;
}

export interface QuoteKpis {
  count: number;
  avgHours: number | null;
  lateCount: number;
  latePct: number | null;
  rows: QuoteKpiRow[];
}

/** Turnaround = working hours from requested_at to sent_at. */
export function quoteTurnaroundHours(q: { requestedAt: number; sentAt: number | null }, cal: WorkCalendar): number | null {
  if (q.sentAt === null) return null;
  return workingHoursBetween(q.requestedAt, q.sentAt, cal);
}

/** Average turnaround and share late (> lateHours working hours) over sent quotes. */
export function quoteKpis(quotes: QuoteForKpi[], cal: WorkCalendar, lateHours: number = QUOTE_LATE_HOURS): QuoteKpis {
  const rows: QuoteKpiRow[] = [];
  for (const q of quotes) {
    const hours = quoteTurnaroundHours(q, cal);
    if (hours === null) continue;
    rows.push({ ...q, hours, late: hours > lateHours + 1e-9 });
  }
  const count = rows.length;
  const lateCount = rows.filter((r) => r.late).length;
  return {
    count,
    avgHours: count ? rows.reduce((s, r) => s + r.hours, 0) / count : null,
    lateCount,
    latePct: count ? (lateCount * 100) / count : null,
    rows,
  };
}

export interface WeeklyPoint {
  weekStart: string; // local Monday YYYY-MM-DD
  count: number;
  avgHours: number;
  latePct: number;
}

/** Weekly average turnaround, grouped by the local week of sent_at. */
export function weeklyTurnaround(quotes: QuoteForKpi[], cal: WorkCalendar, lateHours: number = QUOTE_LATE_HOURS): WeeklyPoint[] {
  const k = quoteKpis(quotes, cal, lateHours);
  const groups = new Map<string, QuoteKpiRow[]>();
  for (const r of k.rows) {
    const w = localWeekStart(r.sentAt as number, cal.timeZone);
    groups.set(w, [...(groups.get(w) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, rows]) => ({
      weekStart,
      count: rows.length,
      avgHours: rows.reduce((s, r) => s + r.hours, 0) / rows.length,
      latePct: (rows.filter((r) => r.late).length * 100) / rows.length,
    }));
}

/** Average turnaround per band result (send_now / pm / ceo). */
export function turnaroundByBand(quotes: QuoteForKpi[], cal: WorkCalendar, lateHours: number = QUOTE_LATE_HOURS) {
  const k = quoteKpis(quotes, cal, lateHours);
  return (['send_now', 'pm', 'ceo'] as BandLevel[]).map((level) => {
    const rows = k.rows.filter((r) => (r.bandResult ?? null) === level);
    return {
      level,
      count: rows.length,
      avgHours: rows.length ? rows.reduce((s, r) => s + r.hours, 0) / rows.length : null,
    };
  });
}

export interface CheckpointForKpi {
  id: string | number;
  taskId: string;
  sentAt: number | null;
  answeredAt: number | null;
}

/** Checkpoint response rate = answered checkpoints ÷ sent checkpoints. */
export function checkpointResponseRate(cps: CheckpointForKpi[]) {
  const sent = cps.filter((c) => c.sentAt !== null);
  const answered = sent.filter((c) => c.answeredAt !== null);
  return { sent: sent.length, answered: answered.length, rate: sent.length ? (answered.length * 100) / sent.length : null };
}

export interface TaskForKpi {
  id: string;
  dueAt: number;
  closedAs: 'on_time' | 'overdue' | null;
  status: string;
}

export interface AlertForKpi {
  taskId: string;
  kind: AlertKind;
  createdAt: number;
}

/**
 * Early-warning rate = tasks that were ever at risk, blocked, silent or overdue and got their
 * first alert before due_at ÷ all such tasks.
 */
export function earlyWarningRate(tasks: TaskForKpi[], alerts: AlertForKpi[]) {
  const firstAlert = new Map<string, number>();
  for (const a of alerts) {
    const prev = firstAlert.get(a.taskId);
    if (prev === undefined || a.createdAt < prev) firstAlert.set(a.taskId, a.createdAt);
  }
  const risky = tasks.filter((t) => t.status !== 'cancelled' && (firstAlert.has(t.id) || t.closedAs === 'overdue'));
  const rows = risky.map((t) => {
    const first = firstAlert.get(t.id) ?? null;
    return { taskId: t.id, firstAlertAt: first, dueAt: t.dueAt, early: first !== null && first < t.dueAt };
  });
  const early = rows.filter((r) => r.early).length;
  return { risky: rows.length, early, rate: rows.length ? (early * 100) / rows.length : null, rows };
}

/** Overdue rate = tasks closed overdue ÷ tasks closed. */
export function overdueRate(tasks: TaskForKpi[]) {
  const closed = tasks.filter((t) => t.closedAs !== null && t.status !== 'cancelled');
  const overdue = closed.filter((t) => t.closedAs === 'overdue');
  return { closed: closed.length, overdue: overdue.length, rate: closed.length ? (overdue.length * 100) / closed.length : null };
}

/** Rounds for display only; KPIs keep full precision. */
export function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
