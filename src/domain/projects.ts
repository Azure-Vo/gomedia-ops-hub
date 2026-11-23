// S1 · 1.6 "Dự án & Task" (docs/PRD-1.6-du-an-va-task.md). A project ("dự án", stored as a Lark parent
// task) belongs to one PM and one Lark group; a task ("task", a Lark sub-task) belongs to one person and
// is only finished once the PM has checked the evidence and approved it. Pure rules only: the Edge
// Function and the web app both use these functions.
import type { WorkCalendar } from './calendar';
import type { GoStarCriterion, GoStarRules } from './gostar';
import type { BotMessage } from './lark';
import { fmtDueDate, normalizeCode, parseDueDate } from './lark';
import { addDays, dateKey, isoWeekday, localDateKey, pad2, toLocalParts } from './time';

// ------------------------------------------------------------------------------------ codes --------

/** PRD 5.1: 2–4 capital letters then 1–4 digits, e.g. MT35, DA056. */
export const PROJECT_CODE_RE = /^[A-Z]{2,4}\d{1,4}$/;
export const PROJECT_CODE_EXAMPLE = 'MT35';

/** Upper-case and drop every space: "mt 35" → "MT35". */
export function normalizeProjectCode(raw: string | null | undefined): string {
  return normalizeCode(raw).replace(/\s+/g, '');
}

export function checkProjectCode(raw: string, existing: Iterable<string> = []): string[] {
  const code = normalizeProjectCode(raw);
  if (!code) return ['Thiếu mã dự án.'];
  if (!PROJECT_CODE_RE.test(code)) return [`Mã dự án "${code}" chưa đúng: 2–4 chữ in hoa rồi 1–4 chữ số, ví dụ ${PROJECT_CODE_EXAMPLE}.`];
  for (const e of existing) if (normalizeProjectCode(e) === code) return [`Mã ${code} đã có dự án khác dùng.`];
  return [];
}

/** PRD 6.1: MT35-01, MT35-02 … MT35-100. Numbers are never reused (the project keeps a counter). */
export function taskCode(projectCode: string, seq: number): string {
  return `${normalizeProjectCode(projectCode)}-${String(seq).padStart(2, '0')}`;
}

/** Title on Lark Tasks, the CEO's layout: "[MT35] Tên dự án" and "Tên task (MT35-07)". */
export function projectTitle(code: string, name: string): string {
  return `[${code}] ${name.trim()}`;
}
export function taskTitle(code: string, name: string): string {
  return `${name.trim()} (${code})`;
}

/** Groups whose name contains the project code are offered first (PRD 5.2). */
export function chatMatchesCode(chatName: string, code: string): boolean {
  const c = normalizeProjectCode(code);
  if (!c) return false;
  return new RegExp(`(^|[^A-Z0-9])${c}([^A-Z0-9]|$)`).test(normalizeCode(chatName));
}

/** Standard group name, typed with any keyboard: "MT35 - Ra mắt BST Tết 2027" (1.7, Long 23/11). */
export function chatNameFor(code: string, name: string): string {
  return `${normalizeProjectCode(code)} - ${name.trim().replace(/\s+/g, ' ')}`;
}

/**
 * A group whose name carries another project's code must not be bound to this project
 * (e.g. "MT35 LOLO" offered for project LL01 while MT35 belongs to another project).
 * Returns the conflicting code, or null.
 */
export function chatCodeConflict(chatName: string, ownCode: string, otherCodes: string[]): string | null {
  const own = normalizeProjectCode(ownCode);
  if (own && chatMatchesCode(chatName, own)) return null;
  return otherCodes.map(normalizeProjectCode).find((c) => c && c !== own && chatMatchesCode(chatName, c)) ?? null;
}

// ------------------------------------------------------------------------------------ dates --------

export function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const r = addDays(y, m, d, days);
  return dateKey(r.year, r.month, r.day);
}

/** Whole calendar days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function isWorkDay(key: string, cal: Pick<WorkCalendar, 'workDays' | 'holidays'>): boolean {
  const [y, m, d] = key.split('-').map(Number);
  return cal.workDays.includes(isoWeekday(y, m, d)) && !cal.holidays.includes(key);
}

/** The date itself when it is a working day, else the next working day. */
export function nextWorkDay(key: string, cal: Pick<WorkCalendar, 'workDays' | 'holidays'>): string {
  let k = key;
  for (let i = 0; i < 30 && !isWorkDay(k, cal); i++) k = shiftKey(k, 1);
  return k;
}

/** Working days in (from, to]: Monday → Tuesday = 1. */
export function workDaysAfter(from: string, to: string, cal: Pick<WorkCalendar, 'workDays' | 'holidays'>): number {
  let n = 0;
  for (let k = shiftKey(from, 1), i = 0; k <= to && i < 400; k = shiftKey(k, 1), i++) if (isWorkDay(k, cal)) n++;
  return n;
}

export function localHM(now: number, timeZone: string): string {
  const p = toLocalParts(now, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Dates of a new task against its project: it cannot start before the project starts (22/11, Long),
 * must end after it starts, and cannot end after the project deadline or in the past.
 */
export function taskDateErrors(t: { startDate: string; dueDate: string | null }, project: { startDate: string; dueDate: string }, today: string): string[] {
  const out: string[] = [];
  if (t.startDate < project.startDate) out.push(`Ngày bắt đầu task không được trước ngày bắt đầu dự án (${fmtDueDate(project.startDate)}).`);
  if (!t.dueDate) return [...out, 'Thiếu deadline.'];
  if (t.dueDate <= t.startDate) out.push('Deadline phải sau ngày bắt đầu.');
  if (t.dueDate > project.dueDate) out.push(`Deadline sau deadline dự án (${fmtDueDate(project.dueDate)}). Gia hạn dự án trước.`);
  if (t.dueDate < today) out.push(`Deadline ${fmtDueDate(t.dueDate)} đã qua.`);
  return out;
}

// ------------------------------------------------------------------------ invitations --------

/** PM invites a person; they accept, or decline with a reason that goes back to the PM (23/11, Long). */
export type MemberStatus = 'invited' | 'accepted' | 'declined';
export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = { invited: 'Đang mời', accepted: 'Đã tham gia', declined: 'Từ chối' };

export function invitationErrors(accept: boolean, reason: string): string[] {
  return !accept && !reason.trim() ? ['Ghi lý do từ chối để PM biết.'] : [];
}

// ---------------------------------------------------------------------- reminder tiers (7.1) --------

export type ReminderTier = 'short' | 'medium' | 'long';

export const TIER_LABEL: Record<ReminderTier, string> = { short: 'Ngắn', medium: 'Vừa', long: 'Dài' };

/** Check-in points (% of the task's duration) and reminder days before the deadline (0 = D0). */
export const TIER_RULES: Record<ReminderTier, { checkins: number[]; before: number[] }> = {
  short: { checkins: [], before: [0] },
  medium: { checkins: [50], before: [1, 0] },
  long: { checkins: [50, 75], before: [2, 1, 0] },
};
/** A task sent back for changes only gets D-1, D0 and the overdue reminders. */
export const CHANGES_BEFORE = [1, 0];

/** PRD 7.1 (A): ≤ 3 days short, 4–7 medium, ≥ 8 long. */
export function autoTier(startDate: string, dueDate: string): ReminderTier {
  const d = daysBetween(startDate, dueDate);
  return d <= 3 ? 'short' : d <= 7 ? 'medium' : 'long';
}

export function tierOf(t: { startDate: string; dueDate: string; tier?: ReminderTier | null }): ReminderTier {
  return t.tier ?? autoTier(t.startDate, t.dueDate);
}

export function tierHint(tier: ReminderTier): string {
  const r = TIER_RULES[tier];
  const ask = r.checkins.length ? `hỏi tiến độ ở mốc ${r.checkins.join('% và ')}%` : 'không hỏi tiến độ';
  const before = r.before.map((b) => (b === 0 ? 'D0' : `D-${b}`)).join(', ');
  return `${ask}; nhắc ${before}; quá hạn nhắc mỗi ngày`;
}

/**
 * Dates of the progress questions: start + round(duration × pct), moved to the next working day.
 * A point that lands on or after the deadline is dropped (the deadline reminder covers it).
 */
export function checkinDates(startDate: string, dueDate: string, tier: ReminderTier, cal: Pick<WorkCalendar, 'workDays' | 'holidays'>): { pct: number; date: string }[] {
  const span = daysBetween(startDate, dueDate);
  const out: { pct: number; date: string }[] = [];
  for (const pct of TIER_RULES[tier].checkins) {
    const date = nextWorkDay(shiftKey(startDate, Math.round((span * pct) / 100)), cal);
    if (date >= dueDate || date <= startDate) continue;
    if (out.some((o) => o.date === date)) continue;
    out.push({ pct, date });
  }
  return out;
}

export type ReminderKind = 'before' | 'due' | 'overdue';
export interface Reminder {
  kind: ReminderKind;
  offset: number;
  label: string;
}

/** Deadline reminder for today, or null. Nothing while the task waits for the PM or is closed. */
export function reminderToday(t: { state: TaskStage; dueDate: string; startDate: string; tier?: ReminderTier | null }, today: string): Reminder | null {
  if (t.state !== 'doing' && t.state !== 'changes') return null;
  const before = t.state === 'changes' ? CHANGES_BEFORE : TIER_RULES[tierOf(t)].before;
  const offset = daysBetween(today, t.dueDate);
  if (offset < 0) return { kind: 'overdue', offset, label: `D+${-offset}` };
  if (!before.includes(offset)) return null;
  return offset === 0 ? { kind: 'due', offset, label: 'D0' } : { kind: 'before', offset, label: `D-${offset}` };
}

/** The progress question to send now: the latest point that is due and not yet sent (only while "Đang làm"). */
export function checkinToSend(
  t: { state: TaskStage; startDate: string; dueDate: string; tier?: ReminderTier | null },
  sentPcts: Iterable<number>,
  today: string,
  cal: Pick<WorkCalendar, 'workDays' | 'holidays'>,
): { pct: number; date: string } | null {
  if (t.state !== 'doing' || today >= t.dueDate) return null;
  if (!isWorkDay(today, cal)) return null;
  const sent = new Set(sentPcts);
  const due = checkinDates(t.startDate, t.dueDate, tierOf(t), cal).filter((c) => c.date <= today && !sent.has(c.pct));
  return due.length ? due[due.length - 1] : null;
}

/** PRD 7.2: unanswered by 09:00 of the next working day after the question → "Chưa cập nhật". */
export function isNoUpdate(sentDate: string, today: string, nowHM: string, cal: Pick<WorkCalendar, 'workDays' | 'holidays'>): boolean {
  const limit = nextWorkDay(shiftKey(sentDate, 1), cal);
  return today > limit || (today === limit && nowHM >= '09:00');
}

/** PRD 7.3: waiting for review more than one working day. */
export function reviewIsLate(reviewSinceDate: string, today: string, cal: Pick<WorkCalendar, 'workDays' | 'holidays'>): boolean {
  return workDaysAfter(reviewSinceDate, today, cal) > 1;
}

// ------------------------------------------------------------------------------- lifecycle --------

export type TaskStage = 'doing' | 'review' | 'changes' | 'done' | 'cancelled';
export type ProjectState = 'active' | 'done' | 'cancelled';

export const TASK_STAGE_LABEL: Record<TaskStage, string> = {
  doing: 'Đang làm',
  review: 'Chờ duyệt',
  changes: 'Cần sửa',
  done: 'Hoàn thành',
  cancelled: 'Đã huỷ',
};

export type TaskAction = 'submit' | 'approve' | 'request_changes' | 'cancel' | 'reopen' | 'extend' | 'progress';

export interface Actor {
  role: string;
  isAssignee: boolean;
  /** The PM of this task's project. */
  isProjectPm: boolean;
}

/** PRD 3 and 6.3. Returns why the action is refused, or null. Nobody can complete a task on someone's behalf. */
export function whyNot(action: TaskAction, state: TaskStage, who: Actor): string | null {
  const pm = who.role === 'pm' && who.isProjectPm;
  switch (action) {
    case 'submit':
    case 'progress':
      if (!who.isAssignee) return 'Chỉ người được giao task mới làm được.';
      if (state !== 'doing' && state !== 'changes') return `Task đang ở trạng thái ${TASK_STAGE_LABEL[state]}.`;
      return null;
    case 'approve':
    case 'request_changes':
      if (!pm) return 'Chỉ PM phụ trách dự án mới duyệt được.';
      if (state !== 'review') return 'Task chưa được nộp để duyệt.';
      return null;
    case 'extend':
      if (!pm) return 'Chỉ PM phụ trách dự án mới gia hạn được.';
      if (state === 'done' || state === 'cancelled') return `Task đã ${TASK_STAGE_LABEL[state].toLowerCase()}.`;
      return null;
    case 'cancel':
      if (!pm) return 'Chỉ PM phụ trách dự án mới huỷ được.';
      if (state === 'done' || state === 'cancelled') return `Task đã ${TASK_STAGE_LABEL[state].toLowerCase()}.`;
      return null;
    case 'reopen':
      if (!pm) return 'Chỉ PM phụ trách dự án mới mở lại được.';
      if (state !== 'done') return 'Chỉ mở lại được task đã hoàn thành.';
      return null;
  }
}

export interface Evidence {
  links: string[];
  files: { path: string; name: string; size: number }[];
}

export function cleanLinks(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/\s+/);
  return [...new Set(list.map((s) => String(s).trim()).filter((s) => /^https?:\/\/\S+$/i.test(s)))].slice(0, 20);
}

/** PRD 6.4: at least one link or one file. */
export function evidenceErrors(e: Evidence): string[] {
  return e.links.length || e.files.length ? [] : ['Thêm ít nhất 1 link hoặc 1 file làm bằng chứng.'];
}

export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;

export type ExtendReason = 'scope' | 'quality';
export const EXTEND_REASON_LABEL: Record<ExtendReason, string> = {
  scope: 'Yêu cầu thay đổi — không tính trễ',
  quality: 'Người làm cần thêm thời gian — vẫn tính trễ',
};
/** When to pick each reason, in plain words (shown under the choice). */
export const EXTEND_REASON_HINT: Record<ExtendReason, string> = {
  scope: 'Khách/PM đổi brief, thêm việc, chờ khách.',
  quality: 'Chưa kịp, hoặc kết quả chưa đạt phải làm lại.',
};

/** PRD 6.4: "scope" moves the KPI deadline with the new date, "quality" keeps the original one. */
export function applyExtension(t: { dueDate: string; kpiDueDate: string }, newDue: string, reason: ExtendReason): { dueDate: string; kpiDueDate: string } {
  return { dueDate: newDue, kpiDueDate: reason === 'scope' ? newDue : t.kpiDueDate };
}

export function extensionErrors(t: { dueDate: string }, newDue: string | null, reason: string | null, projectDue: string, today: string): string[] {
  const out: string[] = [];
  if (!newDue) out.push('Chọn deadline mới.');
  else {
    if (newDue === t.dueDate) out.push('Deadline mới trùng deadline hiện tại.');
    if (newDue < today) out.push('Deadline mới đã qua.');
    if (newDue > projectDue) out.push(`Deadline mới sau deadline dự án (${fmtDueDate(projectDue)}). Gia hạn dự án trước.`);
  }
  if (reason !== 'scope' && reason !== 'quality') out.push('Chọn lý do gia hạn.');
  return out;
}

// --------------------------------------------------------------------- progress and health --------

export type Progress = 'on_plan' | 'behind' | 'blocked';
export const PROGRESS_LABEL: Record<Progress, string> = { on_plan: 'Đúng tiến độ', behind: 'Chậm', blocked: 'Bị chặn' };

export type Health = 'red' | 'amber' | 'green' | 'blue' | 'done' | 'cancelled';
export const HEALTH_LABEL: Record<Health, string> = {
  red: 'Cần can thiệp',
  amber: 'Có nguy cơ',
  green: 'Ổn',
  blue: 'Chờ PM',
  done: 'Xong',
  cancelled: 'Huỷ',
};
const HEALTH_RANK: Record<Health, number> = { red: 5, amber: 4, blue: 3, green: 2, done: 1, cancelled: 0 };
export const worse = (a: Health, b: Health): Health => (HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b);

export interface HealthInput {
  state: TaskStage;
  dueDate: string;
  progress: Progress | null;
  progressNote?: string | null;
  noUpdate: boolean;
  hasEvidence: boolean;
}

/** PRD 6.6: one colour per task, the worst of lifecycle, self-reported progress and time. */
export function taskHealth(t: HealthInput, today: string): { health: Health; reason: string } {
  if (t.state === 'cancelled') return { health: 'cancelled', reason: 'Đã huỷ' };
  if (t.state === 'done') return { health: 'done', reason: 'Đã duyệt' };
  if (t.state === 'review') return t.hasEvidence ? { health: 'blue', reason: 'Chờ PM duyệt' } : { health: 'amber', reason: 'Đã đánh dấu xong trên Lark nhưng chưa có bằng chứng' };
  const left = daysBetween(today, t.dueDate);
  if (left < 0) return { health: 'red', reason: `Quá hạn ${-left} ngày` };
  if (t.progress === 'blocked') return { health: 'red', reason: `Bị chặn${t.progressNote ? `: ${t.progressNote}` : ''}` };
  if (t.progress === 'behind') return { health: 'amber', reason: `Báo chậm${t.progressNote ? `: ${t.progressNote}` : ''}` };
  if (t.noUpdate) return { health: 'amber', reason: 'Chưa trả lời câu hỏi tiến độ' };
  if (t.state === 'changes' && left <= 1) return { health: 'amber', reason: 'Cần sửa và sắp đến hạn' };
  if (t.state === 'changes') return { health: 'green', reason: 'Đang sửa theo góp ý' };
  return { health: 'green', reason: t.progress === 'on_plan' ? 'Báo đúng tiến độ' : 'Đang làm' };
}

export type TimeStatus = 'overdue' | 'soon' | 'ok';
export function timeStatus(t: { state: TaskStage; dueDate: string; startDate: string; tier?: ReminderTier | null }, today: string): TimeStatus {
  const left = daysBetween(today, t.dueDate);
  if (left < 0) return 'overdue';
  const before = t.state === 'changes' ? CHANGES_BEFORE : TIER_RULES[tierOf(t)].before;
  return left <= Math.max(...before) ? 'soon' : 'ok';
}

// ---------------------------------------------------------------------- project roll-up (5.4) --------

export type ProjectStatus = 'cancelled' | 'done' | 'late' | 'red' | 'risk' | 'ok';
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  cancelled: 'Đã huỷ',
  done: 'Hoàn thành',
  late: 'Trễ',
  red: 'Cần can thiệp',
  risk: 'Có nguy cơ',
  ok: 'Đúng tiến độ',
};
/** Order used to sort projects, most urgent first. */
export const PROJECT_STATUS_RANK: Record<ProjectStatus, number> = { late: 0, red: 1, risk: 2, ok: 3, done: 4, cancelled: 5 };

/** PRD 5.4 (A): time spent ahead of tasks approved by more than this many points → "Có nguy cơ". */
export const RISK_GAP_POINTS = 25;

export interface Rollup {
  total: number;
  done: number;
  review: number;
  green: number;
  amber: number;
  red: number;
  /** Approved tasks / all tasks (cancelled excluded), 0–100. */
  pct: number;
  /** Share of the project's time already gone, 0–100. */
  timePct: number;
  status: ProjectStatus;
  reason: string;
}

export function projectRollup(p: { state: ProjectState; startDate: string; dueDate: string }, tasks: { state: TaskStage; health: Health }[], today: string): Rollup {
  const live = tasks.filter((t) => t.state !== 'cancelled');
  const count = (h: Health) => live.filter((t) => t.health === h).length;
  const done = live.filter((t) => t.state === 'done').length;
  const total = live.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const span = Math.max(1, daysBetween(p.startDate, p.dueDate));
  const timePct = Math.max(0, Math.min(100, Math.round((daysBetween(p.startDate, today) / span) * 100)));
  const base = { total, done, review: count('blue'), green: count('green'), amber: count('amber'), red: count('red'), pct, timePct };
  if (p.state === 'cancelled') return { ...base, status: 'cancelled', reason: 'PM đã huỷ dự án' };
  if (total > 0 && done === total) return { ...base, status: 'done', reason: 'Mọi task đã được duyệt' };
  if (today > p.dueDate) return { ...base, status: 'late', reason: `Đã qua deadline dự án ${fmtDueDate(p.dueDate)}` };
  if (base.red) return { ...base, status: 'red', reason: `${base.red} task cần can thiệp` };
  if (base.amber) return { ...base, status: 'risk', reason: `${base.amber} task có nguy cơ` };
  if (total && timePct - pct > RISK_GAP_POINTS) return { ...base, status: 'risk', reason: `Đã đi ${timePct}% thời gian, mới xong ${pct}% task` };
  return { ...base, status: 'ok', reason: total ? 'Đúng tiến độ' : 'Chưa có task' };
}

// ----------------------------------------------------------------------------- KPI M1 (9.1) --------

export type KpiStatus = 'on_time' | 'late' | 'overdue' | 'open' | 'pending' | 'excluded';

export interface KpiFacts {
  state: TaskStage;
  kpiDueDate: string;
  /** When the approved submission was made. */
  acceptedAt: number | null;
  /** When the submission now waiting for review was made. */
  pendingAt: number | null;
}

/**
 * PRD 9.1. On time = the approved submission was made on or before the KPI deadline (submission time,
 * not approval time). A submission waiting for review that was on time is not judged yet ("pending").
 */
export function kpiStatus(t: KpiFacts, now: number, timeZone: string): KpiStatus {
  if (t.state === 'cancelled') return 'excluded';
  if (t.state === 'done' && t.acceptedAt !== null) return localDateKey(t.acceptedAt, timeZone) <= t.kpiDueDate ? 'on_time' : 'late';
  if (t.state === 'review' && t.pendingAt !== null && localDateKey(t.pendingAt, timeZone) <= t.kpiDueDate) return 'pending';
  return t.kpiDueDate < localDateKey(now, timeZone) ? 'overdue' : 'open';
}

/**
 * The same facts in the older { dueDate, completedAt } shape used by larkPeriodKpis and Go Star, or null
 * when the task must not be counted (cancelled, or waiting for review after an on-time submission).
 */
export function kpiTracked(t: KpiFacts, now: number, timeZone: string): { dueDate: string; completedAt: number | null } | null {
  const s = kpiStatus(t, now, timeZone);
  if (s === 'excluded' || s === 'pending') return null;
  return { dueDate: t.kpiDueDate, completedAt: s === 'on_time' || s === 'late' ? t.acceptedAt : null };
}

/** One person's month as the PM sees it when scoring Go Star: the facts behind the stars. */
export interface StatTask {
  id: string;
  code: string;
  name: string;
  state: TaskStage;
  kpiDueDate: string;
  acceptedAt: number | null;
  pendingAt: number | null;
}
export interface PersonMonthTask {
  id: string;
  code: string;
  name: string;
  kpiDueDate: string;
  state: TaskStage;
  status: KpiStatus;
  rounds: number;
  sentBack: number;
  extensions: number;
}
export interface PersonMonthStats {
  tasks: PersonMonthTask[];
  total: number;
  onTime: number;
  late: number;
  overdue: number;
  open: number;
  pending: number;
  /** Approved without ever being sent back. */
  firstPass: number;
  /** "Yêu cầu sửa" decisions across the month's tasks. */
  sentBack: number;
  extScope: number;
  extQuality: number;
  /** Progress check-ins sent, answered, and answered "behind" / "blocked". */
  asked: number;
  answered: number;
  behind: number;
  blocked: number;
}

export function personMonthStats(
  month: string,
  tasks: StatTask[],
  subs: { task_id: string; decision: 'approved' | 'changes' | null }[],
  exts: { task_id: string; reason: ExtendReason }[],
  checkins: { task_id: string; sent_at: string | null; answer: Progress | null }[],
  now: number,
  timeZone: string,
): PersonMonthStats {
  const inMonth = tasks.filter((t) => t.state !== 'cancelled' && t.kpiDueDate.slice(0, 7) === month).sort((a, b) => a.kpiDueDate.localeCompare(b.kpiDueDate) || a.code.localeCompare(b.code));
  const ids = new Set(inMonth.map((t) => t.id));
  const out: PersonMonthStats = { tasks: [], total: inMonth.length, onTime: 0, late: 0, overdue: 0, open: 0, pending: 0, firstPass: 0, sentBack: 0, extScope: 0, extQuality: 0, asked: 0, answered: 0, behind: 0, blocked: 0 };
  for (const t of inMonth) {
    const status = kpiStatus(t, now, timeZone);
    const mine = subs.filter((s) => s.task_id === t.id);
    const back = mine.filter((s) => s.decision === 'changes').length;
    const ext = exts.filter((e) => e.task_id === t.id).length;
    if (status === 'on_time') out.onTime++;
    else if (status === 'late') out.late++;
    else if (status === 'overdue') out.overdue++;
    else if (status === 'pending') out.pending++;
    else if (status === 'open') out.open++;
    if (t.state === 'done' && back === 0) out.firstPass++;
    out.sentBack += back;
    out.tasks.push({ id: t.id, code: t.code, name: t.name, kpiDueDate: t.kpiDueDate, state: t.state, status, rounds: mine.length, sentBack: back, extensions: ext });
  }
  for (const e of exts) if (ids.has(e.task_id)) e.reason === 'scope' ? out.extScope++ : out.extQuality++;
  for (const c of checkins) {
    if (!ids.has(c.task_id) || !c.sent_at) continue;
    out.asked++;
    if (c.answer) out.answered++;
    if (c.answer === 'behind') out.behind++;
    if (c.answer === 'blocked') out.blocked++;
  }
  return out;
}

/**
 * Go Star 1.6.4: a suggested Work Quality score from the month's facts, so the PM can score quickly
 * (or look closer when the suggestion and their own view differ). Share of approved tasks that passed
 * review the first time: ≥ 90% → 5, ≥ 75% → 4, ≥ 50% → 3, ≥ 25% → 2, else 1 (thresholds: A).
 * Fewer than 3 approved tasks is flagged as thin evidence.
 */
export function suggestQuality(s: PersonMonthStats): { score: 1 | 2 | 3 | 4 | 5; firstPass: number; approved: number; thin: boolean } | null {
  const approved = s.onTime + s.late;
  if (!approved) return null;
  const rate = s.firstPass / approved;
  const score = rate >= 0.9 ? 5 : rate >= 0.75 ? 4 : rate >= 0.5 ? 3 : rate >= 0.25 ? 2 : 1;
  return { score, firstPass: s.firstPass, approved, thin: approved < 3 };
}

export type StarSlotState = 'on' | 'off' | 'likely' | 'unlikely' | 'open';
export interface StarSlot {
  key: GoStarCriterion;
  state: StarSlotState;
  note: string;
  /** Only for quality when the PM has not scored yet. */
  suggest?: number;
}
/** Where each of the 5 stars stands: earned, missed, likely from the data, or waiting for the PM. */
export function starOutlook(
  row: { stars: Record<GoStarCriterion, boolean>; score: { quality: number | null; kpiPct: number | null; teamwork: number | null } },
  stats: PersonMonthStats | null,
  rules: Pick<GoStarRules, 'qualityMinScore'>,
): { slots: StarSlot[]; sure: number; likely: number; max: number } {
  const slots: StarSlot[] = [];
  const done = (key: GoStarCriterion, note: string) => slots.push({ key, state: row.stars[key] ? 'on' : 'off', note });
  // The two automatic stars carry no note here: the screen shows their own detail (x/y task, % late).
  done('completion', '');
  done('deadline', '');
  if (row.score.quality !== null) done('quality', `Đã chấm ${row.score.quality}/5`);
  else {
    const q = stats ? suggestQuality(stats) : null;
    if (!q) slots.push({ key: 'quality', state: 'open', note: 'Chưa có task được duyệt' });
    else slots.push({ key: 'quality', state: q.score >= rules.qualityMinScore ? 'likely' : 'unlikely', note: `Gợi ý ${q.score}/5${q.thin ? ' · ít dữ liệu' : ''}`, suggest: q.score });
  }
  if (row.score.kpiPct !== null) done('kpi', `${row.score.kpiPct}%`);
  else slots.push({ key: 'kpi', state: 'open', note: 'Chờ nhập % KPI' });
  if (row.score.teamwork !== null) done('teamwork', `Đã chấm ${row.score.teamwork}/5`);
  else slots.push({ key: 'teamwork', state: 'open', note: 'PM đánh giá' });
  const sure = slots.filter((x) => x.state === 'on').length;
  const likely = sure + slots.filter((x) => x.state === 'likely').length;
  const max = sure + slots.filter((x) => x.state === 'likely' || x.state === 'unlikely' || x.state === 'open').length;
  return { slots, sure, likely, max };
}

export const KPI_STATUS_LABEL: Record<KpiStatus, string> = { on_time: 'Đúng hạn', late: 'Trễ', overdue: 'Quá hạn, chưa nộp', open: 'Chưa đến hạn', pending: 'Đã nộp, chờ duyệt', excluded: 'Không tính' };

// ----------------------------------------------------------------------------- bot messages --------

export interface ProjectRef {
  code: string;
  name: string;
}
export interface TaskRef {
  code: string;
  name: string;
  dueDate: string;
  assigneeName: string | null;
  assigneeOpenId: string | null;
  expectedOutput?: string | null;
}
const pLine = (p: ProjectRef) => ({ icon: '📌', label: 'Dự án', text: projectTitle(p.code, p.name) });
const tLine = (t: TaskRef) => ({ icon: '🔸', label: 'Task', text: taskTitle(t.code, t.name) });
const who = (t: TaskRef, label = 'Người thực hiện') => ({ icon: '👤', label, text: t.assigneeName ?? 'chưa gán', mentionOpenId: t.assigneeOpenId });
const linkLine = (url: string | null | undefined, text = 'Mở trên Ops Hub') => (url ? [{ icon: '🔗', text: `[${text}](${url})` }] : []);

export function taskCreatedMessage(p: ProjectRef, t: TaskRef, url?: string | null): BotMessage {
  return {
    tone: 'blue',
    title: '🆕 Task mới',
    lines: [pLine(p), tLine(t), who(t), { icon: '⏰', label: 'Deadline', text: fmtDueDate(t.dueDate) }, ...(t.expectedOutput ? [{ icon: '🎯', label: 'Kết quả cần nộp', text: t.expectedOutput }] : []), ...linkLine(url)],
    note: 'Xong việc thì bấm Nộp kết quả trên Ops Hub, kèm link hoặc file để PM duyệt.',
  };
}

/** CEO's reminder layout (red/orange title, project, task, @assignee, deadline) with the 1.6 words. */
export function deadlineMessage(p: ProjectRef, t: TaskRef, r: Reminder, url?: string | null): BotMessage {
  const days = Math.abs(r.offset);
  const title = r.kind === 'before' ? `🔴 Task sắp đến hạn – Còn ${days} ngày!` : r.kind === 'due' ? '🔴 Task đến hạn hôm nay!' : `🔴 Task đã quá hạn ${days} ngày – Chưa nộp!`;
  return {
    tone: r.kind === 'before' ? 'orange' : 'red',
    title,
    lines: [pLine(p), tLine(t), who(t), { icon: '⏰', label: 'Hạn chót', text: fmtDueDate(t.dueDate) }, ...linkLine(url, 'Nộp kết quả')],
    note: r.kind === 'before' ? 'Gặp khó khăn thì báo "Bị chặn" để PM hỗ trợ sớm.' : 'Vui lòng nộp kết quả ngay hoặc báo PM.',
    badge: r.label,
  };
}

export function checkinMessage(p: ProjectRef, t: TaskRef, pct: number, taskId: string, url?: string | null): BotMessage {
  return {
    tone: 'blue',
    title: `📍 Tiến độ ${t.code} thế nào?`,
    lines: [pLine(p), tLine(t), { icon: '⏰', label: 'Deadline', text: fmtDueDate(t.dueDate) }, { icon: '⏳', text: `Đã đi khoảng ${pct}% thời gian của task.` }, ...linkLine(url, 'Trả lời hoặc nộp kết quả')],
    note: 'Chọn một nút. Chọn "Bị chặn" thì trả lời kèm lý do trên Ops Hub để PM hỗ trợ.',
    buttons: [
      { text: 'Đúng tiến độ', type: 'primary', value: { op: 'progress', task: taskId, answer: 'on_plan' } },
      { text: 'Chậm', type: 'default', value: { op: 'progress', task: taskId, answer: 'behind' } },
      { text: 'Bị chặn', type: 'danger', value: { op: 'progress', task: taskId, answer: 'blocked' } },
    ],
  };
}

export function blockedMessage(p: ProjectRef, t: TaskRef, reason: string, url?: string | null): BotMessage {
  return { tone: 'red', title: `⛔ ${t.code} bị chặn`, lines: [pLine(p), tLine(t), who(t), { icon: '❗', label: 'Lý do', text: reason || 'chưa ghi' }, ...linkLine(url)], note: 'Nhân sự cần PM hỗ trợ để làm tiếp.' };
}

export function submittedMessage(p: ProjectRef, t: TaskRef, pm: { name: string; openId: string | null }, url?: string | null): BotMessage {
  return {
    tone: 'blue',
    title: `📥 ${t.code} đã nộp, chờ duyệt`,
    lines: [pLine(p), tLine(t), who(t), { icon: '🧑‍💼', label: 'PM duyệt', text: pm.name, mentionOpenId: pm.openId }, ...linkLine(url, 'Xem bằng chứng và duyệt')],
  };
}

export function missingEvidenceMessage(t: TaskRef, url?: string | null): BotMessage {
  return {
    tone: 'orange',
    title: `📎 Thêm bằng chứng cho ${t.code}`,
    lines: [tLine(t), { icon: 'ℹ️', text: 'Bạn đã đánh dấu hoàn thành trên Lark. PM cần link hoặc file kết quả để duyệt.' }, ...linkLine(url, 'Thêm bằng chứng')],
  };
}

export function approvedMessage(p: ProjectRef, t: TaskRef): BotMessage {
  return { tone: 'green', title: `✅ ${t.code} hoàn thành`, lines: [pLine(p), tLine(t), who(t)], note: 'PM đã duyệt kết quả. Cảm ơn bạn 🎉' };
}

export function changesGroupMessage(p: ProjectRef, t: TaskRef, newDue: string | null): BotMessage {
  return {
    tone: 'orange',
    title: `✏️ ${t.code} cần chỉnh sửa`,
    lines: [pLine(p), tLine(t), who(t), { icon: '⏰', label: newDue ? 'Hạn mới' : 'Hạn', text: fmtDueDate(newDue ?? t.dueDate) }],
    note: 'Góp ý chi tiết đã gửi riêng cho người thực hiện.',
  };
}

export function changesDmMessage(p: ProjectRef, t: TaskRef, feedback: string, newDue: string | null, url?: string | null): BotMessage {
  return {
    tone: 'orange',
    title: `✏️ PM góp ý cho ${t.code}`,
    lines: [pLine(p), tLine(t), { icon: '💬', label: 'Góp ý', text: feedback }, { icon: '⏰', label: newDue ? 'Hạn mới' : 'Hạn', text: fmtDueDate(newDue ?? t.dueDate) }, ...linkLine(url, 'Sửa và nộp lại')],
  };
}

export function extendedMessage(p: ProjectRef, t: TaskRef, oldDue: string, newDue: string, reason: ExtendReason): BotMessage {
  return {
    tone: 'blue',
    title: `📅 ${t.code} được gia hạn`,
    lines: [pLine(p), tLine(t), who(t), { icon: '⏰', label: 'Deadline', text: `${fmtDueDate(oldDue)} → ${fmtDueDate(newDue)}` }, { icon: 'ℹ️', label: 'Lý do', text: EXTEND_REASON_LABEL[reason] }],
  };
}

export function cancelledMessage(p: ProjectRef, t: TaskRef, reason: string): BotMessage {
  return { tone: 'grey', title: `🗑️ ${t.code} đã huỷ`, lines: [pLine(p), tLine(t), { icon: 'ℹ️', label: 'Lý do', text: reason }] };
}

export function reopenedMessage(p: ProjectRef, t: TaskRef, reason: string): BotMessage {
  return { tone: 'orange', title: `↩️ ${t.code} được mở lại`, lines: [pLine(p), tLine(t), who(t), { icon: 'ℹ️', label: 'Lý do', text: reason }] };
}

export function projectLinkedMessage(p: ProjectRef & { dueDate: string; pmName: string; pmOpenId: string | null }): BotMessage {
  return {
    tone: 'blue',
    title: `📌 Dự án ${p.code} đã gắn với group này`,
    lines: [pLine(p), { icon: '🧑‍💼', label: 'PM', text: p.pmName, mentionOpenId: p.pmOpenId }, { icon: '⏰', label: 'Deadline dự án', text: fmtDueDate(p.dueDate) }],
    note: 'Task, nhắc hạn và kết quả duyệt của dự án sẽ được báo trong group này.',
  };
}

export function projectDoneMessage(p: ProjectRef, total: number, onTime: number): BotMessage {
  return { tone: 'green', title: `🏁 Dự án ${p.code} hoàn thành`, lines: [pLine(p), { icon: '✅', text: `${total} task đã được duyệt, ${onTime} task đúng hạn.` }], note: 'Cảm ơn cả nhóm!' };
}

export function botMissingMessage(p: ProjectRef, url?: string | null): BotMessage {
  return {
    tone: 'orange',
    title: `🤖 Bot chưa có trong group của ${p.code}`,
    lines: [pLine(p), { icon: 'ℹ️', text: `Thêm bot Go Media vào group Lark của dự án (nên đặt tên group bắt đầu bằng "${p.code}"), rồi bấm "Kiểm tra lại" trên trang dự án.` }, ...linkLine(url, 'Mở dự án')],
    note: 'Trong lúc chưa gắn group, tin của dự án được gửi riêng cho bạn.',
  };
}

export function inviteMessage(p: ProjectRef & { dueDate: string; pmName: string; client?: string | null }, toOpenId: string | null, toName: string, url?: string | null): BotMessage {
  return {
    tone: 'blue',
    title: `📨 Lời mời tham gia dự án ${p.code}`,
    lines: [
      { icon: '👤', label: 'Gửi', text: toName, mentionOpenId: toOpenId },
      pLine(p),
      ...(p.client ? [{ icon: '🏢', label: 'Khách hàng', text: p.client }] : []),
      { icon: '🧑‍💼', label: 'PM', text: p.pmName },
      { icon: '⏰', label: 'Deadline dự án', text: fmtDueDate(p.dueDate) },
      ...linkLine(url, 'Xem và trả lời lời mời'),
    ],
    note: 'Vào Inbox trên Ops Hub để Tham gia hoặc Từ chối (từ chối cần ghi lý do).',
  };
}

export function inviteAnsweredMessage(p: ProjectRef, who: string, accepted: boolean, reason: string | null, url?: string | null): BotMessage {
  return accepted
    ? { tone: 'green', title: `✅ ${who} đã tham gia ${p.code}`, lines: [pLine(p), ...linkLine(url, 'Mở dự án')], note: 'Giờ có thể giao task cho người này.' }
    : {
        tone: 'orange',
        title: `🚫 ${who} từ chối tham gia ${p.code}`,
        lines: [pLine(p), { icon: '❗', label: 'Lý do', text: reason || 'không ghi' }, ...linkLine(url, 'Mở dự án')],
        note: 'Có thể trao đổi rồi mời lại ở tab Thành viên.',
      };
}

export function reviewNudgeMessage(items: { code: string; name: string; days: number }[], url?: string | null): BotMessage {
  return {
    tone: 'orange',
    title: `⏳ ${items.length} task chờ bạn duyệt`,
    lines: [...items.slice(0, 10).map((i) => ({ icon: '📥', text: `${taskTitle(i.code, i.name)} · chờ ${i.days} ngày làm việc` })), ...(items.length > 10 ? [{ icon: '…', text: `và ${items.length - 10} task khác` }] : []), ...linkLine(url, 'Mở trang Chờ duyệt')],
  };
}

// -------------------------------------------------------------------------------- summary (7.6) --------

export interface SummaryTask {
  code: string;
  name: string;
  state: TaskStage;
  dueDate: string;
  health: Health;
  reason: string;
  progress: Progress | null;
  noUpdate: boolean;
  /** Local date the task entered "Chờ duyệt". */
  reviewSince: string | null;
  /** Local dates of today's events. */
  submittedOn: string | null;
  approvedOn: string | null;
}

export interface SummaryProject {
  code: string;
  name: string;
  status: ProjectStatus;
  reason: string;
  overdue: SummaryTask[];
  dueToday: SummaryTask[];
  review: (SummaryTask & { waitDays: number })[];
  blocked: SummaryTask[];
  behind: SummaryTask[];
  noUpdate: SummaryTask[];
  dueTomorrow: SummaryTask[];
  approvedToday: number;
  submittedToday: number;
  /** Number of items that need the PM. */
  weight: number;
}

export function summarizeProject(
  p: { code: string; name: string; status: ProjectStatus; reason: string },
  tasks: SummaryTask[],
  today: string,
  cal: Pick<WorkCalendar, 'workDays' | 'holidays'>,
): SummaryProject {
  const open = tasks.filter((t) => t.state === 'doing' || t.state === 'changes');
  const tomorrow = nextWorkDay(shiftKey(today, 1), cal);
  const out: SummaryProject = {
    code: p.code,
    name: p.name,
    status: p.status,
    reason: p.reason,
    overdue: open.filter((t) => t.dueDate < today),
    dueToday: open.filter((t) => t.dueDate === today),
    review: tasks.filter((t) => t.state === 'review').map((t) => ({ ...t, waitDays: t.reviewSince ? workDaysAfter(t.reviewSince, today, cal) : 0 })).sort((a, b) => b.waitDays - a.waitDays),
    blocked: open.filter((t) => t.progress === 'blocked'),
    behind: open.filter((t) => t.progress === 'behind'),
    noUpdate: open.filter((t) => t.noUpdate && t.progress !== 'blocked' && t.progress !== 'behind'),
    dueTomorrow: open.filter((t) => t.dueDate > today && t.dueDate <= tomorrow),
    approvedToday: tasks.filter((t) => t.approvedOn === today).length,
    submittedToday: tasks.filter((t) => t.submittedOn === today).length,
    weight: 0,
  };
  out.weight = out.overdue.length * 3 + out.blocked.length * 3 + out.review.length * 2 + out.dueToday.length * 2 + out.behind.length + out.noUpdate.length + (p.status === 'late' ? 5 : 0);
  return out;
}

export function sortSummary(list: SummaryProject[]): SummaryProject[] {
  return [...list].sort((a, b) => PROJECT_STATUS_RANK[a.status] - PROJECT_STATUS_RANK[b.status] || b.weight - a.weight || a.code.localeCompare(b.code));
}

const codes = (xs: { code: string }[]) => xs.map((x) => x.code).join(', ');

/** The 08:30 message: one line per project, only what needs attention. */
export function morningSummaryMessage(list: SummaryProject[], today: string, url?: string | null): BotMessage {
  const rows = sortSummary(list).filter((s) => s.status !== 'done' && s.status !== 'cancelled');
  const lines: BotMessage['lines'] = [];
  for (const s of rows) {
    const bits = [
      s.overdue.length && `${s.overdue.length} quá hạn (${codes(s.overdue)})`,
      s.dueToday.length && `${s.dueToday.length} đến hạn hôm nay`,
      s.review.length && `${s.review.length} chờ duyệt`,
      s.blocked.length && `${s.blocked.length} bị chặn (${codes(s.blocked)})`,
      s.behind.length && `${s.behind.length} báo chậm`,
      s.noUpdate.length && `${s.noUpdate.length} chưa cập nhật`,
    ].filter(Boolean);
    lines.push({ icon: s.status === 'ok' ? '🟢' : s.status === 'risk' ? '🟡' : '🔴', label: `${s.code} · ${PROJECT_STATUS_LABEL[s.status]}`, text: bits.length ? bits.join(' · ') : 'không có việc cần xử lý' });
  }
  if (!lines.length) lines.push({ icon: '✅', text: 'Không có dự án nào đang chạy.' });
  return { tone: rows.some((s) => s.status === 'late' || s.status === 'red') ? 'red' : 'blue', title: `☀️ Tóm tắt sáng ${fmtDueDate(today)}`, lines: [...lines, ...linkLine(url, 'Mở Tóm tắt hôm nay')], note: 'Bản chụp lúc gửi. Số mới nhất luôn có trên trang Tóm tắt hôm nay.' };
}

/** The 17:30 message: what got done, what still waits, what is due next. */
export function eveningSummaryMessage(list: SummaryProject[], today: string, url?: string | null): BotMessage {
  const rows = sortSummary(list).filter((s) => s.status !== 'cancelled');
  const sum = (f: (s: SummaryProject) => number) => rows.reduce((n, s) => n + f(s), 0);
  const lines: BotMessage['lines'] = [
    { icon: '✅', label: 'Hôm nay', text: `${sum((s) => s.approvedToday)} task được duyệt · ${sum((s) => s.submittedToday)} task được nộp` },
    { icon: '📥', label: 'Còn chờ duyệt', text: String(sum((s) => s.review.length)) },
  ];
  const dueTomorrow = rows.flatMap((s) => s.dueTomorrow);
  lines.push({ icon: '📅', label: 'Đến hạn ngày làm việc kế tiếp', text: dueTomorrow.length ? dueTomorrow.map((t) => taskTitle(t.code, t.name)).join('; ') : 'không có' });
  const slipping = rows.flatMap((s) => s.dueToday);
  if (slipping.length) lines.push({ icon: '⚠️', label: 'Sẽ quá hạn nếu hôm nay chưa nộp', text: slipping.map((t) => t.code).join(', ') });
  return { tone: slipping.length ? 'orange' : 'green', title: `🌙 Tổng kết ngày ${fmtDueDate(today)}`, lines: [...lines, ...linkLine(url, 'Mở Tóm tắt hôm nay')] };
}

// ------------------------------------------------------------------------- bot commands (10.1) --------

export type ProjectCommand =
  | { kind: 'project'; code: string; name: string; dueDate: string | null; errors: string[] }
  | { kind: 'task'; projectCode: string; name: string; assigneeOpenId: string | null; assigneeName: string | null; dueDate: string | null; expectedOutput: string; errors: string[]; legacy: boolean }
  | { kind: 'help' };

export const PROJECT_HELP_TEXT = [
  'Chỉ PM dùng được các lệnh này.',
  '',
  'Tạo dự án (gõ trong group của dự án thì dự án tự gắn vào group đó):',
  '/taomoi duan <mã> | <tên dự án> | <deadline>',
  'VD: /taomoi duan MT35 | Ra mắt BST Tết | 30/01/2027',
  '',
  'Tạo task (mã task do bot tự sinh):',
  '/taomoi task <mã dự án> | <tên task> | @người thực hiện | <deadline> | <kết quả cần nộp>',
  'VD: /taomoi task MT35 | Push 50 KOC gửi video | @Trâm | 20/01/2027 | 50 video đã đăng + file link',
].join('\n');

/** Reads "/taomoi duan|task …"; the 1.5 forms "/taomoi me|con …" are still accepted. */
export function parseProjectCommand(text: string, mentions: { key: string; openId: string; name: string }[], now: number, timeZone: string): ProjectCommand {
  const t = text.replace(/ /g, ' ').trim();
  const m = t.match(/^\/?(?:tao\s*moi|taomoi|tạo\s*mới|tạomới|tao|tạo)\s+(duan|dự\s*án|du\s*an|task|me|mẹ|con)\b\s*(.*)$/is);
  if (!m) return { kind: 'help' };
  const word = m[1].toLowerCase().replace(/\s+/g, '');
  const parts = m[2].split('|').map((s) => s.trim());
  if (/^(duan|dựán|me|mẹ)$/.test(word)) {
    const legacy = word === 'me' || word === 'mẹ';
    const [code = '', name = ''] = parts;
    const due = legacy ? parts[3] ?? parts[2] ?? '' : parts[2] ?? '';
    const errors: string[] = [];
    if (parts.length < 3) errors.push('Thiếu thông tin: cần mã | tên dự án | deadline, ngăn cách bằng dấu |.');
    const dueDate = due ? parseDueDate(due, now, timeZone) : null;
    if (due && !dueDate) errors.push(`Deadline "${due}" không đọc được (dạng 30/01/2027).`);
    return { kind: 'project', code: normalizeProjectCode(code), name, dueDate, errors };
  }
  const legacy = word === 'con';
  const [codeRaw = '', name = '', whoRaw = '', due = '', output = ''] = parts;
  const code = normalizeCode(codeRaw);
  const projectCode = legacy || code.includes('-') ? code.split('-')[0] : code;
  const mention = mentions.find((x) => whoRaw.includes(x.key)) ?? (mentions.length === 1 && whoRaw.startsWith('@') ? mentions[0] : undefined);
  const errors: string[] = [];
  if (parts.length < 4) errors.push('Thiếu thông tin: cần mã dự án | tên task | @người | deadline | kết quả cần nộp.');
  const dueDate = due ? parseDueDate(due, now, timeZone) : null;
  if (due && !dueDate) errors.push(`Deadline "${due}" không đọc được (dạng 20/01/2027).`);
  return {
    kind: 'task',
    projectCode: normalizeProjectCode(projectCode),
    name,
    assigneeOpenId: mention?.openId ?? null,
    assigneeName: mention?.name ?? (whoRaw.replace(/^@/, '') || null),
    dueDate,
    expectedOutput: output,
    errors,
    legacy,
  };
}

// --------------------------------------------------------------------------- calendar views --------

/** Monday-first weeks covering a month (YYYY-MM): each week is seven YYYY-MM-DD keys. */
export function monthGrid(month: string): string[][] {
  const [y, m] = month.split('-').map(Number);
  const first = dateKey(y, m, 1);
  const start = shiftKey(first, 1 - isoWeekday(y, m, 1));
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const week = Array.from({ length: 7 }, (_, i) => shiftKey(start, w * 7 + i));
    if (w > 0 && week[0].slice(0, 7) !== month) break;
    weeks.push(week);
  }
  return weeks;
}

/** The seven days (Monday first) of the week containing `day`. */
export function weekOf(day: string): string[] {
  const [y, m, d] = day.split('-').map(Number);
  const start = shiftKey(day, 1 - isoWeekday(y, m, d));
  return Array.from({ length: 7 }, (_, i) => shiftKey(start, i));
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}`;
}

/** Workload shade for the people × days view: 0 none, 1 one task, 2 two, 3 three or more. */
export function loadLevel(n: number): 0 | 1 | 2 | 3 {
  return n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3;
}

/** Trang Nhân sự: how much one person carries right now, to decide who gets the next task. */
export type LoadState = 'help' | 'busy' | 'ok' | 'free';
export const LOAD_LABEL: Record<LoadState, string> = { help: 'Cần hỗ trợ', busy: 'Đang kín việc', ok: 'Vừa sức', free: 'Đang rảnh' };
/** Open tasks at or above this, or this many due in the next 7 days, count as "kín việc". */
export const BUSY_OPEN = 5;
export const BUSY_NEXT7 = 3;
export function loadState(c: { open: number; overdue: number; blocked: number; next7: number }): LoadState {
  if (c.overdue > 0 || c.blocked > 0) return 'help';
  if (c.open >= BUSY_OPEN || c.next7 >= BUSY_NEXT7) return 'busy';
  return c.open === 0 ? 'free' : 'ok';
}

/** Project colours for the calendar (navy-family first, then distinct hues readable on white). */
export const PROJECT_COLORS = ['#2F5BD3', '#D9822B', '#2E8B57', '#8A4FC7', '#C0392B', '#1C8C9E', '#B8860B', '#5D6D7E'];
export function colorFor(index: number): string {
  return PROJECT_COLORS[((index % PROJECT_COLORS.length) + PROJECT_COLORS.length) % PROJECT_COLORS.length];
}
