import type { AlertKind, Answer, TaskStatus } from '@/domain';
import { check, supabase } from '@/lib/supabase';

export interface TaskRow {
  id: string;
  name: string;
  owner_id: string;
  type_id: string | null;
  start_at: string;
  due_at: string;
  status: TaskStatus;
  closed_as: 'on_time' | 'overdue' | null;
  closed_at: string | null;
  priority_note: string | null;
  cancel_reason: string | null;
  source: 'app' | 'import';
  created_by: string | null;
  created_at: string;
}

export interface MilestoneRow {
  id: string;
  task_id: string;
  idx: number;
  label: string;
  done_at: string | null;
  evidence_url: string | null;
}

export interface CheckpointRow {
  id: number;
  task_id: string;
  pct: number;
  scheduled_at: string;
  sent_at: string | null;
  sent_via: 'telegram' | 'web' | null;
  answered_at: string | null;
  answer: Answer | null;
  answer_via: 'telegram' | 'web' | null;
  answer_reason: string | null;
  expired_at: string | null;
  no_reply_alerted_at: string | null;
}

export interface AlertRow {
  id: string;
  task_id: string;
  checkpoint_id: number | null;
  kind: AlertKind;
  reason: string | null;
  created_at: string;
  notified_at: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  note: string | null;
}

export interface TaskType {
  id: string;
  name: string;
  milestone_1: string;
  milestone_2: string;
  milestone_3: string;
  milestone_4: string;
  active: boolean;
}

export interface Owner {
  id: string;
  full_name: string;
  email: string;
  role: string;
  telegram_linked: boolean;
}

export const TASK_COLS = 'id, name, owner_id, type_id, start_at, due_at, status, closed_as, closed_at, priority_note, cancel_reason, source, created_by, created_at';
export const MS_COLS = 'id, task_id, idx, label, done_at, evidence_url';
export const CP_COLS = 'id, task_id, pct, scheduled_at, sent_at, sent_via, answered_at, answer, answer_via, answer_reason, expired_at, no_reply_alerted_at';
export const ALERT_COLS = 'id, task_id, checkpoint_id, kind, reason, created_at, notified_at, acknowledged_by, acknowledged_at, note';

export interface TaskBundle {
  tasks: TaskRow[];
  milestones: MilestoneRow[];
  checkpoints: CheckpointRow[];
  alerts: AlertRow[];
}

/** Loads tasks plus their milestones, checkpoints and (if allowed) alerts. */
export async function loadTasks(filter: { ownerId?: string; open?: boolean; ids?: string[]; withAlerts?: boolean }): Promise<TaskBundle> {
  let q = supabase.from('tasks').select(TASK_COLS).order('due_at');
  if (filter.ownerId) q = q.eq('owner_id', filter.ownerId);
  if (filter.open) q = q.is('closed_as', null).neq('status', 'cancelled');
  if (filter.ids) q = q.in('id', filter.ids);
  const tasks = check(await q.limit(1000)) as TaskRow[];
  const ids = tasks.map((t) => t.id);
  if (!ids.length) return { tasks, milestones: [], checkpoints: [], alerts: [] };
  const [ms, cps, als] = await Promise.all([
    supabase.from('milestones').select(MS_COLS).in('task_id', ids).order('idx'),
    supabase.from('checkpoints').select(CP_COLS).in('task_id', ids).order('pct'),
    filter.withAlerts ? supabase.from('alerts').select(ALERT_COLS).in('task_id', ids).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  return { tasks, milestones: check(ms) as MilestoneRow[], checkpoints: check(cps) as CheckpointRow[], alerts: check(als) as AlertRow[] };
}

export async function loadOwners(): Promise<Owner[]> {
  return check(await supabase.rpc('task_owners')) as Owner[];
}

export async function loadTypes(includeInactive = false): Promise<TaskType[]> {
  let q = supabase.from('task_types').select('id, name, milestone_1, milestone_2, milestone_3, milestone_4, active').order('name');
  if (!includeInactive) q = q.eq('active', true);
  return check(await q) as TaskType[];
}

export function typeMilestones(t: TaskType | undefined): string[] {
  return t ? [t.milestone_1, t.milestone_2, t.milestone_3, t.milestone_4] : ['', '', '', ''];
}

/** The checkpoint waiting for an answer, if any. */
export function liveCheckpoint(cps: CheckpointRow[]): CheckpointRow | undefined {
  return cps.filter((c) => c.sent_at && !c.answered_at && !c.expired_at).sort((a, b) => b.pct - a.pct)[0];
}
