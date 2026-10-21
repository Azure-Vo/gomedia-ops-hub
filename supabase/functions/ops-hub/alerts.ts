// Alert delivery to the E-commerce Executive (only during working hours).
import { AlertKind, isWorkingTime } from '../../../src/domain/index';
import { appLink, calendarOf, Ctx, loadSettings } from './context';
import { must } from './http';
import { alertText, linkButton, MilestoneInfo } from './messages';

interface AlertRow {
  id: string;
  task_id: string;
  checkpoint_id: number | null;
  kind: AlertKind;
  reason: string | null;
  notified_at: string | null;
}

async function composeAlert(ctx: Ctx, a: AlertRow, tz: string): Promise<string | null> {
  const task = must(
    await ctx.db.from('tasks').select('id, name, owner_id, due_at, priority_note').eq('id', a.task_id).maybeSingle(),
    'load task',
  ) as { id: string; name: string; owner_id: string; due_at: string; priority_note: string | null } | null;
  if (!task) return null;
  const owner = (await ctx.db.from('profiles').select('full_name, email').eq('id', task.owner_id).maybeSingle()).data as { full_name: string; email: string } | null;
  const milestones = must(await ctx.db.from('milestones').select('idx, label, done_at').eq('task_id', task.id).order('idx'), 'load milestones') as MilestoneInfo[];
  let plannedIdx: number | null = null;
  if (a.checkpoint_id) {
    const cp = (await ctx.db.from('checkpoints').select('pct').eq('id', a.checkpoint_id).maybeSingle()).data as { pct: number } | null;
    if (cp) plannedIdx = [25, 50, 75, 99].indexOf(cp.pct) + 1;
  }
  return alertText({
    kind: a.kind,
    taskName: task.name,
    ownerName: owner?.full_name || owner?.email || 'Không rõ',
    milestones,
    plannedIdx,
    priorityNote: task.priority_note,
    reason: a.reason,
    dueAt: task.due_at,
    tz,
  });
}

/** Sends one alert now if it is working time; otherwise the next dispatch run sends it. */
export async function notifyAlert(ctx: Ctx, alertId: string): Promise<boolean> {
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return false;
  const claimed = must(
    await ctx.db.from('alerts').update({ notified_at: new Date(ctx.now()).toISOString() }).eq('id', alertId).is('notified_at', null).select('id, task_id, checkpoint_id, kind, reason, notified_at'),
    'claim alert',
  ) as AlertRow[];
  if (!claimed.length) return false;
  const text = await composeAlert(ctx, claimed[0], s.timezone);
  if (text) await ctx.notifier.sendToRoles(['ecom_exec'], text, linkButton('Mở trang Cảnh báo', appLink(s, '/alerts')));
  return true;
}

/** Alerts raised outside working hours (or while the bot was down) are sent at the next run. */
export async function deliverPendingAlerts(ctx: Ctx): Promise<number> {
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return 0;
  const since = new Date(ctx.now() - 7 * 24 * 3_600_000).toISOString();
  const rows = must(
    await ctx.db.from('alerts').select('id').is('notified_at', null).is('acknowledged_at', null).gte('created_at', since).order('created_at').limit(50),
    'pending alerts',
  ) as { id: string }[];
  let n = 0;
  for (const r of rows) if (await notifyAlert(ctx, r.id)) n++;
  return n;
}
