// Scheduled jobs (called by pg_cron every 15 minutes).
import { checkpointIndex, CheckpointRow, closeOutcome, planDispatch, statusAfterSilence, TaskRow, TaskStatus, tasksToClose } from '../../../src/domain/index';
import { deliverPendingAlerts, notifyAlert } from './alerts';
import { calendarOf, Ctx, loadSettings } from './context';
import { must } from './http';
import { checkpointButtons, checkpointText } from './messages';
import { deliverPendingApprovals } from './quotes';

interface TaskDb {
  id: string;
  name: string;
  owner_id: string;
  status: TaskStatus;
  due_at: string;
  closed_as: 'on_time' | 'overdue' | null;
}

interface CpDb {
  id: number;
  task_id: string;
  pct: number;
  scheduled_at: string;
  sent_at: string | null;
  answered_at: string | null;
  expired_at: string | null;
  no_reply_alerted_at: string | null;
  token: string;
}

const ms = (v: string | null) => (v ? Date.parse(v) : null);

async function heartbeat(ctx: Ctx, key: string, summary: Record<string, unknown>) {
  const s = await loadSettings(ctx.db);
  const status = { ...(s.system_status ?? {}), [key]: { at: new Date(ctx.now()).toISOString(), ...summary } };
  await ctx.db.from('settings').update({ system_status: status }).eq('id', 1);
}

export async function dispatchCheckpoints(ctx: Ctx) {
  const s = await loadSettings(ctx.db);
  const cal = calendarOf(s);
  const now = ctx.now();
  const tasks = must(
    await ctx.db.from('tasks').select('id, name, owner_id, status, due_at, closed_as').is('closed_as', null).neq('status', 'cancelled'),
    'open tasks',
  ) as TaskDb[];
  const cps = tasks.length
    ? (must(
        await ctx.db
          .from('checkpoints')
          .select('id, task_id, pct, scheduled_at, sent_at, answered_at, expired_at, no_reply_alerted_at, token')
          .in('task_id', tasks.map((t) => t.id)),
        'checkpoints',
      ) as CpDb[])
    : [];
  const rows: CheckpointRow[] = cps.map((c) => ({
    id: c.id,
    taskId: c.task_id,
    pct: c.pct,
    scheduledAt: Date.parse(c.scheduled_at),
    sentAt: ms(c.sent_at),
    answeredAt: ms(c.answered_at),
    expiredAt: ms(c.expired_at),
    noReplyAlertedAt: ms(c.no_reply_alerted_at),
  }));
  const taskRows: TaskRow[] = tasks.map((t) => ({ id: t.id, status: t.status, dueAt: Date.parse(t.due_at), closedAs: t.closed_as }));
  const plan = planDispatch({ now, cal, noReplyWindowHours: s.no_reply_window_hours, tasks: taskRows, checkpoints: rows });
  const nowIso = new Date(now).toISOString();
  const summary = { sent: 0, web_only: 0, expired: 0, no_reply: 0, alerts_sent: 0, approvals_sent: 0, can_send: plan.canSend, retry: 0 };

  if (plan.expire.length) {
    const ids = plan.expire.map((c) => c.id);
    const done = must(await ctx.db.from('checkpoints').update({ expired_at: nowIso }).in('id', ids).is('expired_at', null).select('id'), 'expire') as unknown[];
    summary.expired = done.length;
  }

  for (const cp of plan.noReply) {
    const task = tasks.find((t) => t.id === cp.taskId);
    if (!task) continue;
    const alertId = must(
      await ctx.db.rpc('ops_no_reply', { p: { checkpoint_id: cp.id, new_status: statusAfterSilence(task.status), reason: `Không trả lời checkpoint ${cp.pct}% sau ${s.no_reply_window_hours} giờ làm việc` } }),
      'no reply',
    ) as string | null;
    if (alertId) {
      summary.no_reply++;
      if (await notifyAlert(ctx, alertId)) summary.alerts_sent++;
    }
  }

  for (const cp of plan.send) {
    const task = tasks.find((t) => t.id === cp.taskId)!;
    const claimed = must(
      await ctx.db
        .from('checkpoints')
        .update({ sent_at: nowIso, sent_via: 'web' })
        .eq('id', cp.id)
        .is('sent_at', null)
        .is('expired_at', null)
        .is('answered_at', null)
        .select('id, token'),
      'claim checkpoint',
    ) as { id: number; token: string }[];
    if (!claimed.length) continue;
    const idx = checkpointIndex(cp.pct);
    const ms4 = (await ctx.db.from('milestones').select('label').eq('task_id', task.id).eq('idx', idx).maybeSingle()).data as { label: string } | null;
    const text = checkpointText({ taskName: task.name, pct: cp.pct, idx, milestone: ms4?.label ?? `Mốc ${idx}`, dueAt: task.due_at, tz: cal.timeZone });
    const res = await ctx.notifier.send(task.owner_id, text, checkpointButtons(cp.id as number, claimed[0].token));
    if (res.delivered) {
      await ctx.db.from('checkpoints').update({ sent_via: 'telegram', telegram_message_id: res.messageId ?? null }).eq('id', cp.id);
      summary.sent++;
    } else if (res.reason === 'not_linked' || res.reason === 'no_channel' || res.permanent) {
      summary.web_only++; // the owner answers on the My check-ins page
    } else {
      // Temporary Telegram failure: release the claim so the next run retries.
      await ctx.db.from('checkpoints').update({ sent_at: null, sent_via: null }).eq('id', cp.id);
      summary.retry++;
    }
    await ctx.db.from('events').insert({
      actor: null,
      entity: 'tasks',
      entity_id: task.id,
      action: 'checkpoint.sent',
      payload: { checkpoint_id: cp.id, pct: cp.pct, via: res.delivered ? 'telegram' : 'web', telegram_error: res.delivered ? null : res.reason ?? null },
    });
  }

  if (plan.canSend) {
    summary.alerts_sent += await deliverPendingAlerts(ctx);
    summary.approvals_sent = await deliverPendingApprovals(ctx);
  }
  await heartbeat(ctx, 'dispatch', summary);
  return summary;
}

export async function closeTasks(ctx: Ctx) {
  const now = ctx.now();
  const tasks = must(
    await ctx.db.from('tasks').select('id, name, owner_id, status, due_at, closed_as').is('closed_as', null).neq('status', 'cancelled').lte('due_at', new Date(now).toISOString()),
    'due tasks',
  ) as TaskDb[];
  const due = tasksToClose(tasks.map((t) => ({ id: t.id, status: t.status, dueAt: Date.parse(t.due_at), closedAs: t.closed_as })), now);
  const summary = { closed: 0, on_time: 0, overdue: 0 };
  for (const t of due) {
    const milestones = must(await ctx.db.from('milestones').select('idx, done_at').eq('task_id', t.id).order('idx'), 'milestones') as { idx: number; done_at: string | null }[];
    const outcome = closeOutcome(milestones.map((m) => ms(m.done_at)), t.dueAt);
    let reason: string | null = null;
    if (outcome === 'overdue') {
      const earlier = must(
        await ctx.db.from('alerts').select('id').eq('task_id', t.id).lt('created_at', new Date(t.dueAt).toISOString()).limit(1),
        'earlier alerts',
      ) as unknown[];
      const done = milestones.filter((m) => m.done_at && Date.parse(m.done_at) <= t.dueAt).length;
      reason = `Trễ deadline, xong ${done}/4 mốc. ${earlier.length ? 'Đã có cảnh báo trước deadline.' : 'Không có cảnh báo nào trước deadline.'}`;
    }
    const res = must(
      await ctx.db.rpc('ops_close_task', { p: { task_id: t.id, closed_as: outcome, status: outcome === 'on_time' ? 'done' : 'overdue', reason } }),
      'close task',
    ) as { alert_id: string | null } | null;
    if (!res) continue;
    summary.closed++;
    if (outcome === 'on_time') summary.on_time++;
    else summary.overdue++;
    if (res.alert_id) await notifyAlert(ctx, res.alert_id);
  }
  await heartbeat(ctx, 'close', summary);
  return summary;
}
