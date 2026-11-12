// S1 (brief A2.3): task reminders on Lark. Staff create a parent task and its sub-tasks through the bot,
// Lark Tasks stores them, and every day at 09:00 the bot reminds the group at D-3, D-2, D-1 and from D+1
// until the sub-task is Completed with valid codes. Pure rules only: the Edge Function and the web app
// both use these functions (code check, day offsets, which message to send, the CEO card layout).
import { addDays, dateKey, localDateKey, pad2 } from './time';

// ------------------------------------------------------------------------------------- codes --------

/**
 * Code format, as regular expressions. `{PARENT}` in the sub-task pattern stands for the parent code,
 * so a sub-task code must start with its own parent's code. The defaults follow the only example the
 * brief gives (DA056 / DA056-04-S44); Admin changes them in Settings once Go Media sends its coding rule.
 */
export interface LarkCodeRules {
  parentPattern: string;
  childPattern: string;
  parentExample: string;
  childExample: string;
}

export const DEFAULT_LARK_CODE_RULES: LarkCodeRules = {
  parentPattern: '^[A-Z]{2}\\d{3}$',
  childPattern: '^{PARENT}-\\d{2}-S\\d{2}$',
  parentExample: 'DA056',
  childExample: 'DA056-04-S44',
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripAnchors = (p: string) => p.replace(/^\^/, '').replace(/\$$/, '');

/** Upper-case, trim, and turn typographic dashes (– —) and spaces around dashes into plain "-". */
export function normalizeCode(raw: string | null | undefined): string {
  return String(raw ?? '')
    .normalize('NFC')
    .trim()
    .toUpperCase()
    .replace(/\s*[‐-―−]\s*/g, '-')
    .replace(/\s*-\s*/g, '-');
}

function compile(pattern: string, flags = ''): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/** Problems with the rules themselves (bad regular expression, example that does not pass). */
export function validateCodeRules(r: LarkCodeRules): string[] {
  const out: string[] = [];
  if (!compile(r.parentPattern)) out.push('Mẫu mã task mẹ không phải biểu thức hợp lệ.');
  if (!r.childPattern.includes('{PARENT}')) out.push('Mẫu mã task con phải chứa {PARENT} để kiểm tra liên kết với task mẹ.');
  if (!compile(r.childPattern.replace('{PARENT}', 'X'))) out.push('Mẫu mã task con không phải biểu thức hợp lệ.');
  if (!out.length) {
    if (checkParentCode(r.parentExample, r).length) out.push(`Ví dụ mã task mẹ ${r.parentExample} không khớp mẫu.`);
    else if (checkChildCode(r.childExample, r.parentExample, r).length) out.push(`Ví dụ mã task con ${r.childExample} không khớp mẫu.`);
  }
  return out;
}

export function checkParentCode(raw: string, rules: LarkCodeRules = DEFAULT_LARK_CODE_RULES): string[] {
  const code = normalizeCode(raw);
  if (!code) return ['Thiếu mã task mẹ.'];
  const re = compile(rules.parentPattern);
  if (!re || !re.test(code)) return [`Mã task mẹ "${code}" sai format (đúng dạng: ${rules.parentExample}).`];
  return [];
}

/** Checks the sub-task code's own format and that it belongs to the given parent code. */
export function checkChildCode(raw: string, parentRaw: string, rules: LarkCodeRules = DEFAULT_LARK_CODE_RULES): string[] {
  const code = normalizeCode(raw);
  const parent = normalizeCode(parentRaw);
  if (!code) return ['Thiếu mã task con.'];
  const anyParent = compile(rules.childPattern.replace('{PARENT}', `(?:${stripAnchors(rules.parentPattern)})`));
  if (!anyParent || !anyParent.test(code)) return [`Mã task con "${code}" sai format (đúng dạng: ${rules.childExample}).`];
  if (checkParentCode(parent, rules).length) return [`Mã task mẹ "${parent || '—'}" của task con sai format.`];
  const own = compile(rules.childPattern.replace('{PARENT}', escapeRe(parent)));
  if (!own || !own.test(code)) return [`Mã task con "${code}" không thuộc task mẹ ${parent}.`];
  return [];
}

/** The parent code a sub-task code starts with (the part matching the parent pattern), or null. */
export function parentCodeOf(childRaw: string, rules: LarkCodeRules = DEFAULT_LARK_CODE_RULES): string | null {
  const m = normalizeCode(childRaw).match(compile(`^(${stripAnchors(rules.parentPattern)})`) ?? /$^/);
  return m ? m[1] : null;
}

/** Finds a code inside a Lark task title, e.g. "[DA056] Quản lý KOC" or "Push 50 KOC (DA056-04-S44)". */
export function findCodeInTitle(title: string, kind: 'parent' | 'child', rules: LarkCodeRules = DEFAULT_LARK_CODE_RULES): string | null {
  const body =
    kind === 'parent'
      ? stripAnchors(rules.parentPattern)
      : stripAnchors(rules.childPattern.replace('{PARENT}', `(?:${stripAnchors(rules.parentPattern)})`));
  const re = compile(`(?:^|[^A-Z0-9-])(${body})(?![A-Z0-9-])`, 'i');
  const m = re ? normalizeCode(title).match(re) : null;
  return m ? normalizeCode(m[1]) : null;
}

/** Title written on Lark Tasks, matching Go Media's own titles in the CEO sample. */
export function larkTitle(kind: 'parent' | 'child', code: string, name: string): string {
  const c = normalizeCode(code);
  const n = name.trim();
  if (normalizeCode(n).includes(c)) return n;
  return kind === 'parent' ? `[${c}] ${n}` : `${n} (${c})`;
}

/** Display name without the code we added to the title. */
export function stripCodeFromTitle(title: string, code: string): string {
  const c = escapeRe(normalizeCode(code));
  return title
    .replace(new RegExp(`^\\s*\\[${c}\\]\\s*`, 'i'), '')
    .replace(new RegExp(`\\s*\\(${c}\\)\\s*$`, 'i'), '')
    .trim();
}

// -------------------------------------------------------------------------------- deadlines --------

/** Whole calendar days from today (in the company time zone) to the due date: 3 = due in three days, −1 = one day late. */
export function daysUntil(dueDate: string, now: number, timeZone: string): number {
  const [y, m, d] = dueDate.split('-').map(Number);
  const [ty, tm, td] = localDateKey(now, timeZone).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

export type LarkMilestoneKind = 'before' | 'due' | 'overdue';

export interface LarkMilestone {
  kind: LarkMilestoneKind;
  /** Days before (positive) or after (negative) the deadline. */
  offset: number;
  /** D-3, D-2, D-1, D0, D+1, D+2 … */
  label: string;
}

export interface LarkScheduleOptions {
  /** Brief: "Không gửi" on the deadline day. The CEO infographic shows a D0 card, so Admin can turn it on. */
  notifyD0: boolean;
  /** Days before the deadline that get a reminder. */
  before: number[];
}

export const DEFAULT_LARK_SCHEDULE: LarkScheduleOptions = { notifyD0: false, before: [3, 2, 1] };

export function milestoneLabel(offset: number): string {
  return offset > 0 ? `D-${offset}` : offset === 0 ? 'D0' : `D+${-offset}`;
}

/** Which reminder (if any) a still-open sub-task gets today. After the deadline: every day until done. */
export function milestoneFor(offset: number, opts: LarkScheduleOptions = DEFAULT_LARK_SCHEDULE): LarkMilestone | null {
  if (offset > 0) return opts.before.includes(offset) ? { kind: 'before', offset, label: milestoneLabel(offset) } : null;
  if (offset === 0) return opts.notifyD0 ? { kind: 'due', offset, label: 'D0' } : null;
  return { kind: 'overdue', offset, label: milestoneLabel(offset) };
}

/** Parses 20/11/2026, 20-11-2026, 20/11 (this or next year) or 2026-11-20 into YYYY-MM-DD. */
export function parseDueDate(raw: string, now: number, timeZone: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const vn = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (vn) {
    d = Number(vn[1]);
    m = Number(vn[2]);
    const today = localDateKey(now, timeZone);
    y = vn[3] ? Number(vn[3].length === 2 ? `20${vn[3]}` : vn[3]) : Number(today.slice(0, 4));
    if (!vn[3] && dateKey(y, m, d) < today) y += 1;
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dateKey(y, m, d);
}

export function fmtDueDate(dueDate: string): string {
  const [y, m, d] = dueDate.split('-');
  return `${d}/${m}/${y}`;
}

// ------------------------------------------------------------------------ tracked sub-tasks --------

export interface LarkTracked {
  parentCode: string;
  parentName: string;
  childCode: string;
  childName: string;
  assigneeOpenId: string | null;
  assigneeName: string | null;
  dueDate: string;
  /** Completed on Lark Tasks (ms), or null. */
  completedAt: number | null;
  /** Set once the bot has confirmed completion: nothing more is sent. */
  closedAt?: number | null;
}

export interface CompletionCheck {
  done: boolean;
  codeErrors: string[];
}

/** Brief, step 6: done only when both codes are valid and linked AND the sub-task is Completed. */
export function completionCheck(t: Pick<LarkTracked, 'parentCode' | 'childCode' | 'completedAt'>, rules: LarkCodeRules = DEFAULT_LARK_CODE_RULES): CompletionCheck {
  const codeErrors = [...checkParentCode(t.parentCode, rules), ...checkChildCode(t.childCode, t.parentCode, rules)];
  return { done: t.completedAt !== null && codeErrors.length === 0, codeErrors };
}

export type LarkAction =
  | { type: 'remind'; milestone: LarkMilestone; codeErrors: string[] }
  | { type: 'complete' }
  | { type: 'none'; reason: 'closed' | 'no_milestone' | 'already_sent' };

/**
 * What the daily run does for one sub-task. `sentToday` makes it idempotent: at most one reminder per
 * task per day, so a restart or a second run never sends twice. A sub-task marked Completed with a broken
 * code keeps being reminded, with the code problem written on the card.
 */
export function decideLarkAction(
  t: LarkTracked,
  now: number,
  timeZone: string,
  opts: { rules?: LarkCodeRules; schedule?: LarkScheduleOptions; sentToday: boolean },
): LarkAction {
  if (t.closedAt) return { type: 'none', reason: 'closed' };
  const check = completionCheck(t, opts.rules);
  if (check.done) return { type: 'complete' };
  const ms = milestoneFor(daysUntil(t.dueDate, now, timeZone), opts.schedule);
  if (!ms) return { type: 'none', reason: 'no_milestone' };
  if (opts.sentToday) return { type: 'none', reason: 'already_sent' };
  return { type: 'remind', milestone: ms, codeErrors: t.completedAt !== null ? check.codeErrors : [] };
}

/** M1 for S1 on Lark: share of sub-tasks finished after their deadline or still open past it. */
export function larkLateStats(tasks: Pick<LarkTracked, 'dueDate' | 'completedAt'>[], now: number, timeZone: string) {
  const today = localDateKey(now, timeZone);
  let onTime = 0,
    late = 0,
    openLate = 0,
    open = 0;
  for (const t of tasks) {
    if (t.completedAt !== null) {
      if (localDateKey(t.completedAt, timeZone) <= t.dueDate) onTime++;
      else late++;
    } else if (t.dueDate < today) openLate++;
    else open++;
  }
  const judged = onTime + late + openLate;
  return { total: tasks.length, onTime, late, openLate, open, latePct: judged ? Math.round(((late + openLate) / judged) * 1000) / 10 : null };
}

export type LarkDueStatus = 'on_time' | 'late' | 'overdue' | 'open';

/** Where one sub-task stands against its deadline, by the same rule as larkLateStats. */
export function larkDueStatus(t: Pick<LarkTracked, 'dueDate' | 'completedAt'>, now: number, timeZone: string): LarkDueStatus {
  if (t.completedAt !== null) return localDateKey(t.completedAt, timeZone) <= t.dueDate ? 'on_time' : 'late';
  return t.dueDate < localDateKey(now, timeZone) ? 'overdue' : 'open';
}

export interface LarkNotificationLite {
  taskId: string;
  localDate: string;
  kind: 'reminder' | 'completion';
  status: 'sent' | 'simulated' | 'failed';
}

/**
 * S1 KPIs for the dashboard over a date range (both ends included, local dates "YYYY-MM-DD"):
 * M1 over the sub-tasks due in the range, and the bot's reminders and completion notes sent in it.
 */
export function larkPeriodKpis(
  tasks: (Pick<LarkTracked, 'dueDate' | 'completedAt'> & { id: string })[],
  notifications: LarkNotificationLite[],
  from: string,
  to: string,
  now: number,
  timeZone: string,
) {
  const due = tasks.filter((t) => t.dueDate >= from && t.dueDate <= to);
  const late = larkLateStats(due, now, timeZone);
  const inRange = notifications.filter((n) => n.localDate >= from && n.localDate <= to);
  const delivered = inRange.filter((n) => n.status !== 'failed');
  return {
    ...late,
    judged: late.onTime + late.late + late.openLate,
    taskIds: due.map((t) => t.id),
    reminders: delivered.filter((n) => n.kind === 'reminder').length,
    remindedTasks: new Set(delivered.filter((n) => n.kind === 'reminder').map((n) => n.taskId)).size,
    completions: delivered.filter((n) => n.kind === 'completion').length,
    failed: inRange.filter((n) => n.status === 'failed').length,
  };
}

// ---------------------------------------------------------------------------- bot messages --------

/** A bot message in neutral form: the web app draws it, and toLarkCard turns it into a Lark card. */
export interface BotMessage {
  tone: 'orange' | 'red' | 'green' | 'blue' | 'grey';
  title: string;
  lines: { icon: string; label?: string; text: string; mentionOpenId?: string | null }[];
  note?: string;
  badge?: string;
  buttons?: { text: string; type: 'primary' | 'default' | 'danger'; value: Record<string, string> }[];
}

const parentLine = (code: string, name: string) => (normalizeCode(name).includes(normalizeCode(code)) ? name : `[${normalizeCode(code)}] ${name}`);
const childLine = (code: string, name: string) => (normalizeCode(name).includes(normalizeCode(code)) ? name : `${name} (${normalizeCode(code)})`);

/** The CEO's reminder layout: red/orange title, Task mẹ, Task con, @người thực hiện, Hạn chót. */
export function reminderMessage(t: LarkTracked, ms: LarkMilestone, codeErrors: string[] = []): BotMessage {
  const days = Math.abs(ms.offset);
  const title =
    ms.kind === 'before' ? `🔴 Task sắp đến hạn – Còn ${days} ngày!` : ms.kind === 'due' ? '🔴 Task đến hạn hôm nay!' : '🔴 Task con đã đến hạn – Chưa hoàn thành!';
  const lines: BotMessage['lines'] = [
    { icon: '📌', label: 'Task mẹ', text: parentLine(t.parentCode, t.parentName) },
    { icon: '🔸', label: 'Task con', text: childLine(t.childCode, t.childName) },
    { icon: '👤', label: 'Người thực hiện', text: t.assigneeName ?? 'chưa gán', mentionOpenId: t.assigneeOpenId },
    { icon: '⏰', label: 'Hạn chót', text: fmtDueDate(t.dueDate) },
  ];
  if (ms.kind === 'overdue') lines.push({ icon: '⚠️', text: `Đã quá hạn ${days} ngày.` });
  for (const e of codeErrors) lines.push({ icon: '❗', text: `Task đã Completed nhưng mã chưa hợp lệ: ${e} Sửa mã trên tiêu đề task để dừng nhắc.` });
  return {
    tone: ms.kind === 'before' ? 'orange' : 'red',
    title,
    lines,
    note: ms.kind === 'before' ? 'Vui lòng cập nhật tiến độ task.' : ms.kind === 'due' ? 'Vui lòng hoàn thành và cập nhật tiến độ ngay.' : 'Vui lòng cập nhật ngay.',
    badge: ms.label,
  };
}

export function completionMessage(t: Pick<LarkTracked, 'childCode' | 'completedAt'>, timeZone: string): BotMessage {
  const at = t.completedAt ?? Date.now();
  const [y, m, d] = localDateKey(at, timeZone).split('-');
  return {
    tone: 'green',
    title: '✅ Task đã hoàn thành!',
    lines: [
      { icon: '📌', text: `Task: [${normalizeCode(t.childCode)}] – DONE` },
      { icon: '🕒', text: `Thời gian hoàn thành: ${d}/${m}/${y}` },
    ],
    note: 'Cảm ơn bạn đã cập nhật 🎉',
  };
}

/** Turns a neutral bot message into a Lark interactive card (message card JSON, header + lark_md). */
export function toLarkCard(m: BotMessage): Record<string, unknown> {
  const template = { orange: 'orange', red: 'red', green: 'green', blue: 'blue', grey: 'grey' }[m.tone];
  const body = m.lines
    .map((l) => {
      const value = l.mentionOpenId ? `<at id=${l.mentionOpenId}></at>` : l.text;
      return `${l.icon} ${l.label ? `**${l.label}:** ` : ''}${value}`;
    })
    .join('\n');
  const elements: Record<string, unknown>[] = [{ tag: 'div', text: { tag: 'lark_md', content: body } }];
  if (m.buttons?.length) {
    elements.push({
      tag: 'action',
      actions: m.buttons.map((b) => ({ tag: 'button', text: { tag: 'plain_text', content: b.text }, type: b.type, value: b.value })),
    });
  }
  if (m.note || m.badge) {
    elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: [m.note, m.badge ? `[${m.badge}]` : ''].filter(Boolean).join('  ') }] });
  }
  return { config: { wide_screen_mode: true, update_multi: true }, header: { template, title: { tag: 'plain_text', content: m.title } }, elements };
}

/** Plain text of a message, for logs and for the web history. */
export function messageText(m: BotMessage): string {
  return [m.title, ...m.lines.map((l) => `${l.icon} ${l.label ? `${l.label}: ` : ''}${l.mentionOpenId ? `@${l.text}` : l.text}`), m.note ?? ''].filter(Boolean).join('\n');
}

// ------------------------------------------------------------------------------ creating --------

export interface LarkDraft {
  kind: 'parent' | 'child';
  code: string;
  name: string;
  assigneeOpenId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  description?: string | null;
  /** For a sub-task: the parent code (taken from the sub-task code). */
  parentCode?: string | null;
}

export interface DraftContext {
  rules: LarkCodeRules;
  now: number;
  timeZone: string;
  /** Codes already tracked (to refuse duplicates). */
  existingCodes: Set<string>;
  /** Parent codes that exist, with their deadline (YYYY-MM-DD). */
  parents: Map<string, { dueDate: string | null }>;
}

/** Brief, steps 2.1–2.3 and the first five test cases of step 8. Nothing is created while this returns errors. */
export function validateDraft(d: LarkDraft, ctx: DraftContext): string[] {
  const out: string[] = [];
  const code = normalizeCode(d.code);
  if (d.kind === 'parent') out.push(...checkParentCode(code, ctx.rules));
  else {
    const parent = normalizeCode(d.parentCode || parentCodeOf(code, ctx.rules) || '');
    out.push(...checkChildCode(code, parent, ctx.rules));
    if (!out.length && !ctx.parents.has(parent)) out.push(`Chưa có task mẹ ${parent}. Tạo task mẹ trước, rồi mới tạo task con.`);
    const pd = ctx.parents.get(parent)?.dueDate;
    if (!out.length && pd && d.dueDate && d.dueDate > pd) out.push(`Deadline task con (${fmtDueDate(d.dueDate)}) sau deadline tổng của task mẹ (${fmtDueDate(pd)}).`);
  }
  if (code && ctx.existingCodes.has(code)) out.push(`Mã ${code} đã có trên hệ thống.`);
  if (!d.name.trim()) out.push(d.kind === 'parent' ? 'Thiếu tên task mẹ.' : 'Thiếu tên task con.');
  if (!d.assigneeOpenId) out.push(d.kind === 'parent' ? 'Thiếu người phụ trách (@tag người đó).' : 'Thiếu người thực hiện (@tag người đó).');
  if (!d.dueDate) out.push('Thiếu deadline hoặc ngày không hợp lệ (dạng 20/11/2026).');
  else if (d.dueDate < localDateKey(ctx.now, ctx.timeZone)) out.push(`Deadline ${fmtDueDate(d.dueDate)} đã qua.`);
  return out;
}

export const LARK_HELP_TEXT = [
  'Tạo task mẹ:',
  '/taomoi me <mã> | <tên task mẹ> | @người phụ trách | <deadline>',
  'VD: /taomoi me DA056 | [STING] Quản lý 1600 KOC video Freecast | @Trâm | 30/11/2026',
  '',
  'Tạo task con:',
  '/taomoi con <mã> | <tên task con> | @người thực hiện | <deadline> | <mô tả (không bắt buộc)>',
  'VD: /taomoi con DA056-04-S44 | [STING] Push 50 KOC gửi đủ số lượng video | @Trâm | 20/11/2026',
  '',
  'Bot kiểm tra mã, hiện bản xem trước; bấm "Xác nhận tạo" (hoặc trả lời "xác nhận") để tạo trên Lark Tasks.',
].join('\n');

export interface ParsedCommand {
  draft: LarkDraft | null;
  errors: string[];
  help: boolean;
}

/**
 * Reads "/taomoi me|con …" from a Lark text message. Lark replaces each @mention in the text with a key
 * such as "@_user_1" and lists the real accounts in `mentions`.
 */
export function parseCreateCommand(
  text: string,
  mentions: { key: string; openId: string; name: string }[],
  now: number,
  timeZone: string,
): ParsedCommand {
  const t = text.replace(/ /g, ' ').trim();
  const m = t.match(/^\/?(?:tao\s*moi|taomoi|tạo\s*mới|tạomới|tao|tạo)\s+(me|mẹ|con)\b\s*(.*)$/is);
  if (!m) return { draft: null, errors: [], help: true };
  const kind = /^con$/i.test(m[1]) ? 'child' : 'parent';
  const parts = m[2].split('|').map((s) => s.trim());
  const [code = '', name = '', who = '', due = '', desc = ''] = parts;
  const mention = mentions.find((x) => who.includes(x.key)) ?? (mentions.length === 1 && who.startsWith('@') ? mentions[0] : undefined);
  const errors: string[] = [];
  if (parts.length < 4) errors.push(`Thiếu thông tin: cần ${kind === 'parent' ? 4 : '4–5'} phần, ngăn cách bằng dấu |.`);
  const dueDate = due ? parseDueDate(due, now, timeZone) : null;
  return {
    help: false,
    errors,
    draft: {
      kind,
      code: normalizeCode(code),
      name,
      assigneeOpenId: mention?.openId ?? null,
      assigneeName: mention?.name ?? (who.replace(/^@/, '') || null),
      dueDate,
      description: desc || null,
    },
  };
}

/** Bot preview before creating (brief 2.4), with confirm / cancel buttons. */
export function draftPreviewMessage(d: LarkDraft, draftId: string, parentName?: string | null): BotMessage {
  const lines: BotMessage['lines'] =
    d.kind === 'parent'
      ? [{ icon: '📌', label: 'Task mẹ', text: parentLine(d.code, d.name) }]
      : [
          { icon: '📌', label: 'Task mẹ', text: parentName ? parentLine(d.parentCode ?? '', parentName) : normalizeCode(d.parentCode ?? '') },
          { icon: '🔸', label: 'Task con', text: childLine(d.code, d.name) },
        ];
  lines.push({ icon: '👤', label: d.kind === 'parent' ? 'Người phụ trách' : 'Người thực hiện', text: d.assigneeName ?? '', mentionOpenId: d.assigneeOpenId });
  lines.push({ icon: '⏰', label: d.kind === 'parent' ? 'Deadline tổng' : 'Deadline', text: d.dueDate ? fmtDueDate(d.dueDate) : '—' });
  if (d.description) lines.push({ icon: '📝', label: 'Mô tả', text: d.description });
  return {
    tone: 'blue',
    title: d.kind === 'parent' ? 'Xác nhận tạo task mẹ' : 'Xác nhận tạo task con',
    lines,
    note: 'Mã hợp lệ. Bấm Xác nhận tạo để lưu lên Lark Tasks.',
    buttons: [
      { text: 'Xác nhận tạo', type: 'primary', value: { op: 'confirm', draft: draftId } },
      { text: 'Huỷ', type: 'default', value: { op: 'cancel', draft: draftId } },
    ],
  };
}

export function errorMessage(title: string, errors: string[]): BotMessage {
  return { tone: 'red', title, lines: errors.map((e) => ({ icon: '❌', text: e })), note: 'Sửa lại rồi gửi lệnh lần nữa. Gõ "help" để xem cú pháp.' };
}

/** Today's date and the next date a run should happen, for status displays. */
export function larkToday(now: number, timeZone: string): string {
  return localDateKey(now, timeZone);
}

export function shiftDate(dateKeyStr: string, days: number): string {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const r = addDays(y, m, d, days);
  return `${r.year}-${pad2(r.month)}-${pad2(r.day)}`;
}
