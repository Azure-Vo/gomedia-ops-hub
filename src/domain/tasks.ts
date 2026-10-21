// Task checkpoint rules: schedule, answers, silence, closing.
import { addWorkingMs, isWorkingTime, WorkCalendar, workingMsBetween } from './calendar';
import { Instant, toMs } from './time';

export const CHECKPOINT_PCTS = [25, 50, 75, 99] as const;
export type CheckpointPct = (typeof CHECKPOINT_PCTS)[number];

export type TaskStatus = 'not_started' | 'on_track' | 'at_risk' | 'blocked' | 'no_update' | 'done' | 'overdue' | 'cancelled';
export type Answer = 'on_plan' | 'behind' | 'blocked';
export type AlertKind = 'at_risk' | 'blocker' | 'no_reply' | 'overdue';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Chưa bắt đầu',
  on_track: 'Đúng kế hoạch',
  at_risk: 'Có rủi ro',
  blocked: 'Bị chặn',
  no_update: 'Không cập nhật',
  done: 'Hoàn thành',
  overdue: 'Trễ hạn',
  cancelled: 'Đã huỷ',
};

export const ANSWER_LABEL: Record<Answer, string> = {
  on_plan: 'Đúng kế hoạch',
  behind: 'Chậm hơn kế hoạch',
  blocked: 'Bị chặn',
};

export const ALERT_LABEL: Record<AlertKind, string> = {
  at_risk: 'Có rủi ro',
  blocker: 'Bị chặn',
  no_reply: 'Không trả lời',
  overdue: 'Trễ hạn',
};

/** Checkpoint number 1–4 for 25/50/75/99%. */
export function checkpointIndex(pct: number): 1 | 2 | 3 | 4 {
  const i = CHECKPOINT_PCTS.indexOf(pct as CheckpointPct);
  if (i < 0) throw new Error(`Unknown checkpoint ${pct}%`);
  return (i + 1) as 1 | 2 | 3 | 4;
}

/**
 * Four check-in times at 25%, 50%, 75% and 99% of the task's working time,
 * rounded to the minute. Mon 08:00 → Fri 17:30 gives Tue 10:00, Wed 12:00, Thu 15:30, Fri 17:06.
 */
export function checkpointTimes(start: Instant, due: Instant, cal: WorkCalendar): Date[] {
  const a = toMs(start);
  const b = toMs(due);
  if (!(b > a)) throw new Error('Deadline must be after the start');
  const totalMin = workingMsBetween(a, b, cal) / 60000;
  if (!(totalMin >= 1)) throw new Error('The task has no working time between start and deadline');
  return CHECKPOINT_PCTS.map((pct) => new Date(addWorkingMs(a, Math.round((totalMin * pct) / 100) * 60000, cal)));
}

export interface TaskDraftInput {
  name: string;
  ownerId: string | null;
  startAt: number | null;
  dueAt: number | null;
  milestones: string[];
  /** When given, a deadline already passed is refused: the close job would count it overdue at once. */
  now?: number;
}

/** Problems that block creating a task, in Vietnamese. */
export function validateTaskDraft(t: TaskDraftInput, cal: WorkCalendar): string[] {
  const errors: string[] = [];
  if (!t.name.trim()) errors.push('Nhập tên task.');
  if (!t.ownerId) errors.push('Chọn người phụ trách.');
  if (t.startAt === null) errors.push('Nhập thời điểm bắt đầu.');
  if (t.dueAt === null) errors.push('Nhập deadline.');
  if (t.startAt !== null && t.dueAt !== null) {
    if (t.dueAt <= t.startAt) errors.push('Deadline phải sau thời điểm bắt đầu.');
    else if (workingMsBetween(t.startAt, t.dueAt, cal) < 60_000) errors.push('Từ lúc bắt đầu đến deadline không có giờ làm việc nào.');
  }
  if (t.dueAt !== null && t.now !== undefined && t.dueAt <= t.now) errors.push('Deadline đã qua: task này không đưa vào theo dõi được (sẽ bị tính trễ hạn ngay).');
  if (t.milestones.length !== 4 || t.milestones.some((m) => !m.trim())) errors.push('Cần đủ 4 mốc kiểm chứng, mỗi mốc có nội dung.');
  return errors;
}

export interface TaskState {
  doneCount: number; // milestones done, 0–4 (always the first N)
  status: TaskStatus;
}

export interface AnswerEffect {
  doneCount: number;
  status: TaskStatus;
  /** Milestone numbers (1–4) to mark done now. */
  markDone: number[];
  alert: { kind: 'at_risk' | 'blocker'; reason: string | null } | null;
}

/**
 * answerEffect(task, checkpoint, answer):
 * On plan marks the planned milestone (and any before it) done; Behind keeps the count and
 * raises an At risk alert; Blocked needs a reason and raises a Blocker alert at once.
 * `checkpoint` is the checkpoint number 1–4, or null for a blocker reported between checkpoints.
 */
export function answerEffect(task: TaskState, checkpoint: 1 | 2 | 3 | 4 | null, answer: Answer, reason?: string | null): AnswerEffect {
  if (task.status === 'cancelled' || task.status === 'overdue') throw new Error('Task is closed');
  const done = Math.max(0, Math.min(4, task.doneCount));
  if (answer === 'on_plan') {
    if (checkpoint === null) throw new Error('On plan needs a checkpoint');
    const newDone = Math.max(done, checkpoint);
    const markDone: number[] = [];
    for (let i = done + 1; i <= newDone; i++) markDone.push(i);
    return { doneCount: newDone, status: newDone >= 4 ? 'done' : 'on_track', markDone, alert: null };
  }
  if (answer === 'behind') {
    if (checkpoint === null) throw new Error('Behind needs a checkpoint');
    return { doneCount: done, status: 'at_risk', markDone: [], alert: { kind: 'at_risk', reason: null } };
  }
  const why = (reason ?? '').trim();
  if (!why) throw new Error('A blocker needs a reason');
  return { doneCount: done, status: 'blocked', markDone: [], alert: { kind: 'blocker', reason: why } };
}

export interface CheckpointRow {
  id: string | number;
  taskId: string;
  pct: number;
  scheduledAt: number;
  sentAt: number | null;
  answeredAt: number | null;
  expiredAt: number | null;
  noReplyAlertedAt: number | null;
}

export interface TaskRow {
  id: string;
  status: TaskStatus;
  dueAt: number;
  closedAs: 'on_time' | 'overdue' | null;
}

export function isTaskOpen(t: TaskRow, now: number): boolean {
  return t.closedAs === null && t.status !== 'cancelled' && t.status !== 'overdue' && now < t.dueAt;
}

export interface DispatchPlan {
  /** Checkpoints to send now (at most one per task: the latest due one). */
  send: CheckpointRow[];
  /** Earlier checkpoints superseded by a newer one, or no longer needed. */
  expire: CheckpointRow[];
  /** Sent, unanswered checkpoints that have been silent for the no-reply window. */
  noReply: CheckpointRow[];
  /** False outside working hours: nothing is sent then. */
  canSend: boolean;
}

/** Silence is a risk: true once a sent checkpoint has waited `windowHours` working hours. */
export function noReplyDue(cp: CheckpointRow, now: number, windowHours: number, cal: WorkCalendar): boolean {
  if (cp.sentAt === null || cp.answeredAt !== null || cp.noReplyAlertedAt !== null) return false;
  return workingMsBetween(cp.sentAt, now, cal) >= windowHours * 3_600_000 - 1;
}

/** What the 15-minute dispatch job should do now. Never sends outside working hours. */
export function planDispatch(input: {
  now: Instant;
  cal: WorkCalendar;
  noReplyWindowHours: number;
  tasks: TaskRow[];
  checkpoints: CheckpointRow[];
}): DispatchPlan {
  const now = toMs(input.now);
  const canSend = isWorkingTime(now, input.cal);
  const byTask = new Map<string, CheckpointRow[]>();
  for (const cp of input.checkpoints) {
    const list = byTask.get(cp.taskId) ?? [];
    list.push(cp);
    byTask.set(cp.taskId, list);
  }
  const plan: DispatchPlan = { send: [], expire: [], noReply: [], canSend };
  for (const task of input.tasks) {
    const cps = (byTask.get(task.id) ?? []).sort((a, b) => a.pct - b.pct);
    const open = isTaskOpen(task, now);
    if (!open || task.status === 'done') {
      // Finished or closed: unsent checkpoints are no longer needed.
      for (const cp of cps) if (cp.sentAt === null && cp.expiredAt === null) plan.expire.push(cp);
      continue;
    }
    for (const cp of cps) if (noReplyDue(cp, now, input.noReplyWindowHours, input.cal)) plan.noReply.push(cp);
    if (!canSend) continue;
    const due = cps.filter((cp) => cp.sentAt === null && cp.expiredAt === null && cp.scheduledAt <= now);
    if (!due.length) continue;
    const latest = due[due.length - 1];
    plan.send.push(latest);
    for (const cp of cps) {
      if (cp === latest || cp.expiredAt !== null || cp.answeredAt !== null) continue;
      if (cp.pct < latest.pct) plan.expire.push(cp); // older ones: skipped or superseded
    }
  }
  return plan;
}

/** At the deadline: on time only if all 4 milestones were done by due_at. */
export function closeOutcome(milestoneDoneAt: (number | null)[], dueAt: number): 'on_time' | 'overdue' {
  const doneInTime = milestoneDoneAt.filter((t) => t !== null && t <= dueAt).length;
  return milestoneDoneAt.length >= 4 && doneInTime >= 4 ? 'on_time' : 'overdue';
}

export function tasksToClose(tasks: TaskRow[], now: Instant): TaskRow[] {
  const t = toMs(now);
  return tasks.filter((task) => task.closedAs === null && task.status !== 'cancelled' && task.dueAt <= t);
}

/** Task status after a checkpoint went unanswered for the no-reply window. */
export function statusAfterSilence(status: TaskStatus): TaskStatus {
  return status === 'blocked' || status === 'done' || status === 'overdue' || status === 'cancelled' ? status : 'no_update';
}

/** Board order: blocked, no update, at risk first; then by deadline. */
export function riskRank(status: TaskStatus): number {
  const order: TaskStatus[] = ['blocked', 'no_update', 'at_risk', 'not_started', 'on_track', 'overdue', 'done', 'cancelled'];
  return order.indexOf(status);
}
