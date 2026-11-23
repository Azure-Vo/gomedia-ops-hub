// Data for the 1.6 "Dự án & Task" pages. Reads go straight to Supabase under Row Level Security
// (a staff member only gets the projects they belong to); every change goes through the Edge Function
// actions "work.*", which apply the same rules (src/domain/projects.ts).
import {
  Health,
  isNoUpdate,
  kpiStatus,
  KpiStatus,
  localDateKey,
  localHM,
  Progress,
  projectRollup,
  ProjectState,
  ReminderTier,
  Rollup,
  TaskStage,
  taskHealth,
  timeStatus,
  TimeStatus,
  WorkCalendar,
} from '@/domain';
import type { BotMessage } from '@/domain';
import { check, supabase } from '@/lib/supabase';

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  client: string | null;
  description: string | null;
  start_date: string;
  due_date: string;
  kpi_due_date: string | null;
  state: ProjectState;
  pm_id: string | null;
  assignee_name: string | null;
  color: string | null;
  chat_id: string | null;
  chat_name: string | null;
  chat_status: 'none' | 'linked' | 'missing';
  mode: 'simulation' | 'live';
  lark_url: string | null;
  cancel_reason: string | null;
  next_seq: number;
  created_at: string;
}
export const PROJECT_COLS =
  'id, code, name, client, description, start_date, due_date, kpi_due_date, state, pm_id, assignee_name, color, chat_id, chat_name, chat_status, mode, lark_url, cancel_reason, next_seq, created_at';

export interface TaskRow {
  id: string;
  parent_id: string;
  code: string;
  seq: number | null;
  name: string;
  description: string | null;
  expected_output: string | null;
  assignee_id: string | null;
  assignee_open_id: string | null;
  assignee_name: string | null;
  start_date: string;
  due_date: string;
  original_due_date: string | null;
  kpi_due_date: string | null;
  state: TaskStage;
  tier: ReminderTier | null;
  progress: Progress | null;
  progress_note: string | null;
  progress_at: string | null;
  review_since: string | null;
  accepted_at: string | null;
  approved_at: string | null;
  cancel_reason: string | null;
  mode: 'simulation' | 'live';
  lark_url: string | null;
  created_at: string;
}
export const TASK_COLS =
  'id, parent_id, code, seq, name, description, expected_output, assignee_id, assignee_open_id, assignee_name, start_date, due_date, original_due_date, kpi_due_date, state, tier, progress, progress_note, progress_at, review_since, accepted_at, approved_at, cancel_reason, mode, lark_url, created_at';

export interface MemberRow {
  id: string;
  project_id: string;
  profile_id: string | null;
  open_id: string | null;
  name: string;
  source: 'group' | 'task' | 'manual';
  status: 'invited' | 'accepted' | 'declined';
  invited_at: string | null;
  responded_at: string | null;
  decline_reason: string | null;
}
export const MEMBER_COLS = 'id, project_id, profile_id, open_id, name, source, status, invited_at, responded_at, decline_reason';

export interface InvitationRow {
  id: string;
  project_id: string;
  status: 'invited' | 'accepted' | 'declined';
  invited_at: string | null;
  code: string;
  name: string;
  client: string | null;
  start_date: string;
  due_date: string;
  pm_name: string | null;
  color: string | null;
}

/** Invitations waiting for the signed-in person (view my_project_invitations). */
export async function loadInvitations(): Promise<InvitationRow[]> {
  return check(await supabase.from('my_project_invitations').select('id, project_id, status, invited_at, code, name, client, start_date, due_date, pm_name, color').eq('status', 'invited').order('invited_at', { ascending: false })) as InvitationRow[];
}

export interface SubmissionRow {
  id: string;
  task_id: string;
  round: number;
  via: 'web' | 'lark';
  submitted_by: string | null;
  submitted_at: string;
  note: string | null;
  links: string[];
  files: { path: string; name: string; size: number }[];
  decision: 'approved' | 'changes' | null;
  decided_by: string | null;
  decided_at: string | null;
  feedback: string | null;
}
export const SUB_COLS = 'id, task_id, round, via, submitted_by, submitted_at, note, links, files, decision, decided_by, decided_at, feedback';

export interface CheckinRow {
  task_id: string;
  pct: number;
  due_date: string;
  sent_at: string | null;
  answer: Progress | null;
  answer_reason: string | null;
  answered_at: string | null;
}

export interface ExtensionRow {
  id: string;
  task_id: string;
  from_date: string;
  to_date: string;
  reason: 'scope' | 'quality';
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface BotMessageRow {
  id: string;
  project_id: string | null;
  task_id: string | null;
  kind: string;
  channel: 'group' | 'dm';
  to_name: string | null;
  local_date: string;
  status: 'sent' | 'simulated' | 'failed';
  attempts: number;
  last_error: string | null;
  message: BotMessage;
  sent_at: string | null;
  created_at: string;
}
export const MSG_COLS = 'id, project_id, task_id, kind, channel, to_name, local_date, status, attempts, last_error, message, sent_at, created_at';

export interface PersonRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  active: boolean;
}

/** A task with everything the screens show about it. */
export interface Task extends TaskRow {
  project: ProjectRow;
  health: Health;
  reason: string;
  time: TimeStatus;
  noUpdate: boolean;
  /** Progress question sent and not answered yet (its % point). */
  asked: number | null;
  hasEvidence: boolean;
  pending: SubmissionRow | null;
  kpi: KpiStatus;
}

export interface Project extends ProjectRow {
  tasks: Task[];
  rollup: Rollup;
  members: MemberRow[];
}

export interface WorkData {
  projects: Project[];
  tasks: Task[];
  people: PersonRow[];
  today: string;
}

const hasEvidence = (s: SubmissionRow | null | undefined) => !!s && (s.links?.length > 0 || s.files?.length > 0);

/** Health, time status, "no update" and KPI status for one task (src/domain/projects.ts). */
export function deriveTask(t: TaskRow, project: ProjectRow, checkins: CheckinRow[], pending: SubmissionRow | null, now: number, cal: WorkCalendar): Task {
  const tz = cal.timeZone;
  const today = localDateKey(now, tz);
  const last = checkins.filter((c) => c.task_id === t.id && c.sent_at).sort((a, b) => b.pct - a.pct)[0];
  const noUpdate = (t.state === 'doing' || t.state === 'changes') && !!last && !last.answered_at && isNoUpdate(localDateKey(Date.parse(last.sent_at!), tz), today, localHM(now, tz), cal);
  const ev = hasEvidence(pending);
  const h = taskHealth({ state: t.state, dueDate: t.due_date, progress: t.progress, progressNote: t.progress_note, noUpdate, hasEvidence: ev }, today);
  return {
    ...t,
    project,
    health: h.health,
    reason: h.reason,
    time: timeStatus({ state: t.state, dueDate: t.due_date, startDate: t.start_date, tier: t.tier }, today),
    noUpdate,
    asked: (t.state === 'doing' || t.state === 'changes') && last && !last.answered_at ? last.pct : null,
    hasEvidence: ev,
    pending,
    kpi: kpiStatus({ state: t.state, kpiDueDate: t.kpi_due_date ?? t.due_date, acceptedAt: t.accepted_at ? Date.parse(t.accepted_at) : null, pendingAt: pending ? Date.parse(pending.submitted_at) : null }, now, tz),
  };
}

/** Loads the projects (and their tasks, members, pending submissions, check-ins) the user can see. */
export async function loadWork(cal: WorkCalendar, opts: { projectCode?: string } = {}): Promise<WorkData> {
  const now = Date.now();
  let pq = supabase.from('lark_tasks').select(PROJECT_COLS).eq('kind', 'parent').is('deleted_at', null).order('due_date');
  if (opts.projectCode) pq = pq.ilike('code', opts.projectCode);
  const projects = check(await pq) as unknown as ProjectRow[];
  const ids = projects.map((p) => p.id);
  const [tasks, members, people] = await Promise.all([
    ids.length ? supabase.from('lark_tasks').select(TASK_COLS).eq('kind', 'child').is('deleted_at', null).in('parent_id', ids).order('due_date') : Promise.resolve({ data: [], error: null }),
    ids.length ? supabase.from('project_members').select(MEMBER_COLS).in('project_id', ids) : Promise.resolve({ data: [], error: null }),
    supabase.from('profiles').select('id, full_name, email, role, active').order('full_name'),
  ]).then((r) => r.map((x) => check(x as { data: unknown; error: null })) as [TaskRow[], MemberRow[], PersonRow[]]);
  const openIds = tasks.filter((t) => t.state !== 'done' && t.state !== 'cancelled').map((t) => t.id);
  const [subs, checkins] = openIds.length
    ? await Promise.all([
        supabase.from('task_submissions').select(SUB_COLS).in('task_id', openIds).is('decision', null),
        supabase.from('task_checkins').select('task_id, pct, due_date, sent_at, answer, answer_reason, answered_at').in('task_id', openIds),
      ]).then((r) => r.map((x) => check(x as { data: unknown; error: null })) as [SubmissionRow[], CheckinRow[]])
    : [[], []];
  const pendingOf = new Map(subs.map((s) => [s.task_id, s]));
  const byId = new Map(projects.map((p) => [p.id, p]));
  const derived = tasks.filter((t) => byId.has(t.parent_id)).map((t) => deriveTask(t, byId.get(t.parent_id)!, checkins, pendingOf.get(t.id) ?? null, now, cal));
  const today = localDateKey(now, cal.timeZone);
  const full: Project[] = projects.map((p) => {
    const mine = derived.filter((t) => t.parent_id === p.id);
    return {
      ...p,
      tasks: mine,
      members: members.filter((m) => m.project_id === p.id),
      rollup: projectRollup({ state: p.state, startDate: p.start_date, dueDate: p.due_date }, mine.map((t) => ({ state: t.state, health: t.health })), today),
    };
  });
  return { projects: full, tasks: derived, people, today };
}

export async function loadTaskHistory(taskId: string) {
  const [subs, exts, checkins] = await Promise.all([
    supabase.from('task_submissions').select(SUB_COLS).eq('task_id', taskId).order('round'),
    supabase.from('task_extensions').select('id, task_id, from_date, to_date, reason, note, created_by, created_at').eq('task_id', taskId).order('created_at'),
    supabase.from('task_checkins').select('task_id, pct, due_date, sent_at, answer, answer_reason, answered_at').eq('task_id', taskId).order('pct'),
  ]);
  return { submissions: check(subs) as SubmissionRow[], extensions: check(exts) as ExtensionRow[], checkins: check(checkins) as CheckinRow[] };
}

export async function loadMessages(opts: { projectId?: string; limit?: number } = {}): Promise<BotMessageRow[]> {
  let q = supabase.from('bot_messages').select(MSG_COLS).order('created_at', { ascending: false }).limit(opts.limit ?? 200);
  if (opts.projectId) q = q.eq('project_id', opts.projectId);
  return check(await q) as unknown as BotMessageRow[];
}

/** Is this user the assignee of the task? (Simulation stores "sim:<profile id>" as the Lark id.) */
export const isMine = (t: Pick<TaskRow, 'assignee_id' | 'assignee_open_id'>, userId: string) => t.assignee_id === userId || t.assignee_open_id === `sim:${userId}`;

export const isProjectPm = (p: Pick<ProjectRow, 'pm_id'>, user: { id: string; role: string }) => user.role === 'pm' && (!p.pm_id || p.pm_id === user.id);

export const MANAGER_ROLES = ['pm', 'ceo'];
export const isManagerRole = (role: string) => MANAGER_ROLES.includes(role);
