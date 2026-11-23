// S1 · 1.6 "Dự án & Task" on the server (docs/PRD-1.6-du-an-va-task.md). Projects are Lark parent tasks
// with a PM and a Lark group; tasks are Lark sub-tasks that the assignee submits with evidence and the PM
// approves or sends back. All writes go through here (service role) after the same checks as the web app
// (src/domain/projects.ts). Every message is logged in bot_messages with a unique key, so a retry or a
// second run never sends the same thing twice. Simulation mode runs the same flow without calling Lark.
import {
  applyExtension,
  quoteLinkErrors,
  QuoteOutcome,
  approvedMessage,
  blockedMessage,
  botMissingMessage,
  BotMessage,
  cancelledMessage,
  changesDmMessage,
  changesGroupMessage,
  chatCodeConflict,
  chatMatchesCode,
  chatNameFor,
  checkinMessage,
  checkinToSend,
  checkProjectCode,
  cleanLinks,
  colorFor,
  deadlineMessage,
  evidenceErrors,
  eveningSummaryMessage,
  extendedMessage,
  extensionErrors,
  ExtendReason,
  fmtDueDate,
  invitationErrors,
  inviteAnsweredMessage,
  inviteMessage,
  taskDateErrors,
  isNoUpdate,
  isWorkDay,
  kpiStatus,
  localDateKey,
  localHM,
  MAX_EVIDENCE_BYTES,
  missingEvidenceMessage,
  morningSummaryMessage,
  normalizeProjectCode,
  parseProjectCommand,
  Progress,
  PROJECT_HELP_TEXT,
  projectDoneMessage,
  projectLinkedMessage,
  projectRollup,
  projectTitle,
  reminderToday,
  reopenedMessage,
  reviewIsLate,
  reviewNudgeMessage,
  submittedMessage,
  summarizeProject,
  SummaryProject,
  SummaryTask,
  TaskAction,
  taskCode,
  taskCreatedMessage,
  taskHealth,
  TaskStage,
  taskTitle,
  ReminderTier,
  toLarkCard,
  whyNot,
  workDaysAfter,
  WorkCalendar,
} from '../../../src/domain/index';
import { appLink, calendarOf, Ctx, loadProfile, loadSettings, Profile, SettingsRow } from './context';
import { ApiError, must } from './http';
import { dueToLark, LarkApi, LarkConfig, LarkError, loadLarkConfig, rememberPeople } from './lark';

// ------------------------------------------------------------------------------------ rows --------

export interface WorkRow {
  id: string;
  kind: 'parent' | 'child';
  parent_id: string | null;
  code: string;
  name: string;
  description: string | null;
  client: string | null;
  assignee_open_id: string | null;
  assignee_name: string | null;
  assignee_id: string | null;
  due_date: string;
  start_date: string;
  original_due_date: string | null;
  kpi_due_date: string | null;
  mode: 'simulation' | 'live';
  lark_guid: string | null;
  lark_url: string | null;
  lark_title: string | null;
  completed_at: string | null;
  closed_at: string | null;
  state: string;
  seq: number | null;
  next_seq: number;
  color: string | null;
  pm_id: string | null;
  chat_id: string | null;
  chat_name: string | null;
  chat_status: 'none' | 'linked' | 'missing';
  chat_warned_at: string | null;
  expected_output: string | null;
  tier: ReminderTier | null;
  progress: Progress | null;
  progress_note: string | null;
  progress_at: string | null;
  review_since: string | null;
  accepted_at: string | null;
  approved_at: string | null;
  cancel_reason: string | null;
}
export const WORK_COLS =
  'id, kind, parent_id, code, name, description, client, assignee_open_id, assignee_name, assignee_id, due_date, start_date, original_due_date, kpi_due_date, mode, lark_guid, lark_url, lark_title, completed_at, closed_at, state, seq, next_seq, color, pm_id, chat_id, chat_name, chat_status, chat_warned_at, expected_output, tier, progress, progress_note, progress_at, review_since, accepted_at, approved_at, cancel_reason';

interface Submission {
  id: string;
  task_id: string;
  round: number;
  via: 'web' | 'lark';
  submitted_at: string;
  note: string | null;
  links: string[];
  files: { path: string; name: string; size: number }[];
  decision: 'approved' | 'changes' | null;
}
const SUB_COLS = 'id, task_id, round, via, submitted_at, note, links, files, decision';
const hasEvidence = (s: Pick<Submission, 'links' | 'files'> | null | undefined) => !!s && ((s.links?.length ?? 0) > 0 || (s.files?.length ?? 0) > 0);

// ------------------------------------------------------------------------------ environment --------

interface Settings16 extends SettingsRow {
  summary_morning_time?: string;
  summary_evening_time?: string;
  summary_evening_on?: boolean;
}

export interface WorkEnv {
  cfg: LarkConfig;
  settings: Settings16;
  cal: WorkCalendar;
  api: LarkApi | null;
  now: number;
  today: string;
  nowHM: string;
}

export async function workEnv(ctx: Ctx, api?: LarkApi | null): Promise<WorkEnv> {
  const cfg = await loadLarkConfig(ctx);
  const settings = (await loadSettings(ctx.db)) as Settings16;
  const now = ctx.now();
  let client = api ?? null;
  if (api === undefined && cfg.mode === 'live' && cfg.appId && cfg.appSecret) client = new LarkApi(cfg.apiBase, cfg.appId, cfg.appSecret, ctx.fetchImpl ?? fetch);
  return { cfg, settings, cal: calendarOf(settings), api: client, now, today: localDateKey(now, cfg.timeZone), nowHM: localHM(now, cfg.timeZone) };
}

const link = (w: WorkEnv, path: string) => appLink(w.settings, path);
const projectLink = (w: WorkEnv, p: WorkRow) => link(w, `/du-an/${encodeURIComponent(p.code)}`);
const taskLink = (w: WorkEnv, p: WorkRow, t: WorkRow) => link(w, `/du-an/${encodeURIComponent(p.code)}?task=${t.id}`);

async function loadRow(ctx: Ctx, id: string): Promise<WorkRow | null> {
  if (!id) return null;
  return must(await ctx.db.from('lark_tasks').select(WORK_COLS).eq('id', id).is('deleted_at', null).maybeSingle(), 'load row') as WorkRow | null;
}

async function loadProjectByCode(ctx: Ctx, code: string): Promise<WorkRow | null> {
  return must(await ctx.db.from('lark_tasks').select(WORK_COLS).eq('kind', 'parent').ilike('code', normalizeProjectCode(code)).is('deleted_at', null).maybeSingle(), 'load project') as WorkRow | null;
}

async function loadTaskAndProject(ctx: Ctx, taskId: string): Promise<{ task: WorkRow; project: WorkRow }> {
  const task = await loadRow(ctx, taskId);
  if (!task || task.kind !== 'child' || !task.parent_id) throw new ApiError(404, 'not_found', 'Không tìm thấy task.');
  const project = await loadRow(ctx, task.parent_id);
  if (!project) throw new ApiError(404, 'not_found', 'Không tìm thấy dự án của task.');
  return { task, project };
}

// --------------------------------------------------------------------------------- people --------

interface Person {
  openId: string | null;
  name: string;
}

/** The Lark identity of an Ops Hub user: "sim:<id>" in simulation, the linked open_id when live. */
async function personOf(ctx: Ctx, w: WorkEnv, profileId: string | null): Promise<Person> {
  if (!profileId) return { openId: null, name: '' };
  const p = must(await ctx.db.from('profiles').select('id, full_name, email').eq('id', profileId).maybeSingle(), 'load profile') as { id: string; full_name: string; email: string } | null;
  const name = p ? p.full_name || p.email : '';
  if (w.cfg.mode === 'simulation') {
    const openId = `sim:${profileId}`;
    await ctx.db.from('lark_people').upsert({ open_id: openId, name, profile_id: profileId, updated_at: new Date().toISOString() }, { onConflict: 'open_id' });
    return { openId, name };
  }
  const lp = must(await ctx.db.from('lark_people').select('open_id, name').eq('profile_id', profileId).not('open_id', 'like', 'sim:%').limit(1).maybeSingle(), 'load lark person') as { open_id: string; name: string } | null;
  return { openId: lp?.open_id ?? null, name: name || lp?.name || '' };
}

async function profileIdOfOpenId(ctx: Ctx, openId: string | null): Promise<string | null> {
  if (!openId) return null;
  if (openId.startsWith('sim:')) return openId.slice(4);
  const lp = must(await ctx.db.from('lark_people').select('profile_id').eq('open_id', openId).maybeSingle(), 'load person') as { profile_id: string | null } | null;
  return lp?.profile_id ?? null;
}

async function pmOf(ctx: Ctx, w: WorkEnv, project: WorkRow): Promise<Person> {
  if (project.pm_id) return personOf(ctx, w, project.pm_id);
  return { openId: project.assignee_open_id, name: project.assignee_name ?? 'PM' };
}

/** Members from the Lark group or from a task assignment count as accepted (they are already in). */
async function addMember(ctx: Ctx, projectId: string, m: { profileId: string | null; openId: string | null; name: string }, source: 'group' | 'task' | 'manual') {
  if (!m.profileId && !m.openId) return;
  const { error } = await ctx.db.from('project_members').insert({ project_id: projectId, profile_id: m.profileId, open_id: m.openId, name: m.name, source, status: 'accepted', responded_at: new Date().toISOString() });
  if (error && error.code !== '23505' && !/duplicate key/.test(error.message)) throw new Error(`save member: ${error.message}`);
  if (error && source === 'group') {
    const q = ctx.db.from('project_members').update({ status: 'accepted', decline_reason: null }).eq('project_id', projectId).neq('status', 'accepted');
    await (m.profileId ? q.eq('profile_id', m.profileId) : q.eq('open_id', m.openId!));
  }
}

/** PRD 1.6.1: the PM invites someone; the bot tells them on Lark and the invitation waits in their Inbox. */
async function inviteMember(ctx: Ctx, w: WorkEnv, project: WorkRow, profileId: string, by: Profile) {
  const p = await personOf(ctx, w, profileId);
  const stamp = new Date(ctx.now()).toISOString();
  const cur = must(await ctx.db.from('project_members').select('id, status').eq('project_id', project.id).eq('profile_id', profileId).maybeSingle(), 'load member') as { id: string; status: string } | null;
  if (cur?.status === 'accepted' || cur?.status === 'invited') return false;
  if (cur) must(await ctx.db.from('project_members').update({ status: 'invited', invited_by: by.id, invited_at: stamp, responded_at: null, decline_reason: null, source: 'manual' }).eq('id', cur.id), 'invite again');
  else must(await ctx.db.from('project_members').insert({ project_id: project.id, profile_id: profileId, open_id: p.openId, name: p.name, source: 'manual', status: 'invited', invited_by: by.id, invited_at: stamp }), 'invite');
  await sendWork(ctx, w, {
    kind: 'invite',
    project,
    to: p,
    key: `invite|${project.id}|${profileId}|${stamp}`,
    message: inviteMessage({ ...pRef(project), dueDate: project.due_date, pmName: by.full_name || by.email, client: project.client }, p.openId, p.name, link(w, '/inbox')),
  });
  return true;
}

/** The invited person accepts, or declines with a reason; the PM is told either way. */
export async function respondInvitation(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const project = await loadRow(ctx, String(body.project_id ?? ''));
  if (!project || project.kind !== 'parent') throw new ApiError(404, 'not_found', 'Không tìm thấy dự án.');
  const row = must(await ctx.db.from('project_members').select('id, status').eq('project_id', project.id).eq('profile_id', user.id).maybeSingle(), 'load invitation') as { id: string; status: string } | null;
  if (!row || row.status !== 'invited') throw new ApiError(409, 'conflict', 'Không có lời mời nào đang chờ bạn trả lời ở dự án này.');
  const accept = body.accept === true;
  const reason = String(body.reason ?? '').trim();
  const errs = invitationErrors(accept, reason);
  if (errs.length) throw new ApiError(400, 'invalid', errs.join(' '));
  const stamp = new Date(ctx.now()).toISOString();
  must(await ctx.db.from('project_members').update({ status: accept ? 'accepted' : 'declined', responded_at: stamp, decline_reason: accept ? null : reason }).eq('id', row.id).eq('status', 'invited'), 'answer invitation');
  const pm = await pmOf(ctx, w, project);
  await sendWork(ctx, w, { kind: accept ? 'invite_accepted' : 'invite_declined', project, to: pm, key: `invite_answer|${row.id}|${stamp}`, message: inviteAnsweredMessage(pRef(project), user.full_name || user.email, accept, accept ? null : reason, projectLink(w, project)) });
  return { ok: true, status: accept ? 'accepted' : 'declined' };
}

function actorOf(user: Profile, task: WorkRow, project: WorkRow) {
  return {
    role: user.role,
    isAssignee: task.assignee_id === user.id || task.assignee_open_id === `sim:${user.id}`,
    isProjectPm: user.role === 'pm' && (!project.pm_id || project.pm_id === user.id),
  };
}

function refuse(action: TaskAction, state: string, actor: ReturnType<typeof actorOf>) {
  const why = whyNot(action, state as TaskStage, actor);
  if (why) throw new ApiError(403, 'forbidden', why);
}

function requireProjectPm(user: Profile, project: WorkRow) {
  if (user.role !== 'pm') throw new ApiError(403, 'forbidden', 'Chỉ PM mới làm được thao tác này.');
  if (project.pm_id && project.pm_id !== user.id) throw new ApiError(403, 'forbidden', 'Chỉ PM phụ trách dự án này mới làm được.');
}

// ------------------------------------------------------------------------------- messages --------

const MAX_ATTEMPTS = 5;

interface SendReq {
  kind: string;
  project: WorkRow | null;
  task?: WorkRow | null;
  to: 'group' | Person;
  message: BotMessage;
  key: string | null;
}

/** Lark answers these codes when the bot is not (or no longer) in the group (U: to confirm on a real app). */
const NOT_IN_CHAT = new Set([230002, 232011, 232025]);

/**
 * Sends one message (or simulates it) and logs it. Group messages of a project that has no linked
 * group go to its PM directly (PRD 5.2). Projects created before 1.6 keep using the old shared group.
 */
export async function sendWork(ctx: Ctx, w: WorkEnv, r: SendReq): Promise<boolean> {
  let channel: 'group' | 'dm' = 'dm';
  let chatId: string | null = null;
  let to: Person = { openId: null, name: '' };
  let message = r.message;
  if (r.to === 'group') {
    if (r.project?.chat_status === 'linked' && r.project.chat_id) {
      channel = 'group';
      chatId = r.project.chat_id;
    } else if (r.project?.chat_status === 'none' && w.cfg.chatId) {
      channel = 'group';
      chatId = w.cfg.chatId;
    } else {
      to = r.project ? await pmOf(ctx, w, r.project) : to;
      message = { ...message, note: [message.note, 'Dự án chưa gắn group Lark nên tin được gửi riêng cho PM.'].filter(Boolean).join(' ') };
    }
  } else to = r.to;

  const base = {
    project_id: r.project?.id ?? null,
    task_id: r.task?.id ?? null,
    kind: r.kind,
    channel,
    chat_id: chatId,
    to_open_id: channel === 'dm' ? to.openId : null,
    to_name: channel === 'dm' ? to.name : null,
    dedupe_key: r.key,
    local_date: w.today,
    message,
    status: 'failed',
    attempts: 1,
    last_error: 'đang gửi',
  };
  let slot: { id: string; attempts: number } | null = null;
  const ins = await ctx.db.from('bot_messages').insert(base).select('id, attempts').maybeSingle();
  if (!ins.error && ins.data) slot = ins.data as { id: string; attempts: number };
  else if (r.key) {
    const cur = must(await ctx.db.from('bot_messages').select('id, attempts, status').eq('dedupe_key', r.key).maybeSingle(), 'load message') as { id: string; attempts: number; status: string } | null;
    if (!cur || cur.status !== 'failed' || cur.attempts >= MAX_ATTEMPTS) return false;
    const upd = must(await ctx.db.from('bot_messages').update({ attempts: cur.attempts + 1, message }).eq('id', cur.id).eq('attempts', cur.attempts).select('id, attempts'), 'claim retry') as { id: string; attempts: number }[];
    slot = upd[0] ?? null;
    if (!slot) return false;
  } else throw new Error(`save message: ${ins.error?.message}`);

  try {
    let messageId: string | null = null;
    if (w.cfg.mode === 'live') {
      if (!w.api) throw new Error('Chưa có App ID / App Secret của Lark.');
      const uuid = `${slot.id.slice(0, 18)}-${slot.attempts}`;
      if (channel === 'group') messageId = (await w.api.sendCard(chatId!, toLarkCard(message), uuid)).message_id;
      else {
        if (!to.openId || to.openId.startsWith('sim:')) throw new Error(`${to.name || 'Người nhận'} chưa liên kết tài khoản Lark.`);
        messageId = (await w.api.sendCardToUser(to.openId, toLarkCard(message), uuid)).message_id;
      }
    }
    must(
      await ctx.db
        .from('bot_messages')
        .update({ status: w.cfg.mode === 'live' ? 'sent' : 'simulated', last_error: null, sent_at: new Date(ctx.now()).toISOString(), lark_message_id: messageId })
        .eq('id', slot.id),
      'save message',
    );
    return true;
  } catch (e) {
    await ctx.db.from('bot_messages').update({ status: 'failed', last_error: (e as Error).message.slice(0, 500) }).eq('id', slot.id);
    if (channel === 'group' && r.project?.chat_status === 'linked' && e instanceof LarkError && NOT_IN_CHAT.has(Number(e.code))) {
      await ctx.db.from('lark_tasks').update({ chat_status: 'missing', chat_warned_at: null }).eq('id', r.project.id);
    }
    return false;
  }
}

const pRef = (p: WorkRow) => ({ code: p.code, name: p.name });
const tRef = (t: WorkRow) => ({ code: t.code, name: t.name, dueDate: t.due_date, assigneeName: t.assignee_name, assigneeOpenId: t.assignee_open_id, expectedOutput: t.expected_output });
const assignee = (t: WorkRow): Person => ({ openId: t.assignee_open_id, name: t.assignee_name ?? '' });

async function tryLark(what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error(`lark ${what} failed`, (e as Error).message);
  }
}

// ---------------------------------------------------------------------------- Lark groups --------

/** Live: refreshes the list of groups the bot is in. Simulation: the groups the PM created. */
export async function listChats(ctx: Ctx, user: Profile, body: Record<string, unknown> = {}) {
  if (!['pm', 'ceo', 'admin'].includes(user.role)) throw new ApiError(403, 'forbidden', 'Chỉ PM, CEO hoặc Admin.');
  const w = await workEnv(ctx);
  if (w.cfg.mode === 'live' && w.api && body.refresh !== false) {
    const chats = await w.api.listChats();
    const stamp = new Date(ctx.now()).toISOString();
    if (chats.length) must(await ctx.db.from('lark_chats').upsert(chats.map((c) => ({ chat_id: c.chat_id, name: c.name, mode: 'live', active: true, updated_at: stamp })), { onConflict: 'chat_id' }), 'save chats');
    const ids = new Set(chats.map((c) => c.chat_id));
    const known = must(await ctx.db.from('lark_chats').select('chat_id').eq('mode', 'live').eq('active', true), 'load chats') as { chat_id: string }[];
    const gone = known.filter((k) => !ids.has(k.chat_id)).map((k) => k.chat_id);
    if (gone.length) await ctx.db.from('lark_chats').update({ active: false, updated_at: stamp }).in('chat_id', gone);
  }
  const rows = must(await ctx.db.from('lark_chats').select('chat_id, name, mode, active').eq('mode', w.cfg.mode).eq('active', true).order('name'), 'load chats') as { chat_id: string; name: string }[];
  // Which project already uses each group, so the picker can show it and refuse it.
  const used = must(await ctx.db.from('lark_tasks').select('id, code, chat_id').eq('kind', 'parent').is('deleted_at', null).neq('state', 'cancelled').not('chat_id', 'is', null), 'chat usage') as { id: string; code: string; chat_id: string }[];
  const by = new Map(used.map((u) => [u.chat_id, u]));
  return { mode: w.cfg.mode, chats: rows.map((r) => ({ ...r, used_by: by.get(r.chat_id)?.code ?? null, used_by_id: by.get(r.chat_id)?.id ?? null })), codes: [...new Set(used.map((u) => u.code))] };
}

/**
 * Simulation: the bot "creates" the project's group. The name is always "<MÃ> - <Tên dự án>" (no free typing),
 * and a code that already has a group, or belongs to another project, is refused.
 */
export async function createSimChat(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  if (user.role !== 'pm' && user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ PM hoặc Admin.');
  const w = await workEnv(ctx);
  if (w.cfg.mode !== 'simulation') throw new ApiError(400, 'live', 'Đang kết nối Lark thật: hãy thêm bot vào group trên Lark.');
  const code = normalizeProjectCode(String(body.code ?? ''));
  const title = String(body.name ?? '').trim();
  const codeErr = checkProjectCode(code);
  if (codeErr.length) throw new ApiError(400, 'invalid', `Nhập mã dự án hợp lệ trước khi tạo group. ${codeErr.join(' ')}`);
  if (!title) throw new ApiError(400, 'invalid', 'Nhập tên dự án trước khi tạo group.');
  const projectId = body.project_id ? String(body.project_id) : null;
  const owner = must(await ctx.db.from('lark_tasks').select('id, name').eq('kind', 'parent').eq('code', code).is('deleted_at', null).maybeSingle(), 'check code') as { id: string; name: string } | null;
  if (owner && owner.id !== projectId) throw new ApiError(409, 'code_taken', `Mã ${code} đang là của dự án "${owner.name}". Đổi mã dự án trước khi tạo group.`);
  const chats = must(await ctx.db.from('lark_chats').select('chat_id, name').eq('mode', 'simulation').eq('active', true), 'load chats') as { chat_id: string; name: string }[];
  const same = chats.find((c) => chatMatchesCode(c.name, code));
  if (same) throw new ApiError(409, 'chat_exists', `Đã có group cho mã ${code}: "${same.name}". Chọn group đó trong danh sách.`);
  const row = { chat_id: `sim-chat:${crypto.randomUUID()}`, name: chatNameFor(code, title), mode: 'simulation', active: true };
  must(await ctx.db.from('lark_chats').insert(row), 'save chat');
  return { chat: row };
}

/** Simulation: remove a group made by mistake. Only one no project is using. */
export async function deleteSimChat(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  if (user.role !== 'pm' && user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ PM hoặc Admin.');
  const w = await workEnv(ctx);
  const chatId = String(body.chat_id ?? '');
  if (w.cfg.mode !== 'simulation' || !chatId.startsWith('sim-chat:')) throw new ApiError(400, 'live', 'Group Lark thật: giải tán hoặc xoá bot khỏi group trên Lark.');
  const holder = must(await ctx.db.from('lark_tasks').select('code, name').eq('kind', 'parent').eq('chat_id', chatId).is('deleted_at', null).limit(1).maybeSingle(), 'check chat') as { code: string; name: string } | null;
  if (holder) throw new ApiError(409, 'in_use', `Group đang gắn với dự án ${holder.code} (${holder.name}). Bỏ gắn trước khi xoá.`);
  must(await ctx.db.from('lark_chats').delete().eq('chat_id', chatId), 'delete chat');
  return { ok: true };
}

async function syncMembersFromChat(ctx: Ctx, w: WorkEnv, project: WorkRow) {
  if (w.cfg.mode !== 'live' || !w.api || project.chat_status !== 'linked' || !project.chat_id) return;
  const members = await w.api.chatMembers(project.chat_id);
  await rememberPeople(ctx, members);
  const people = must(await ctx.db.from('lark_people').select('open_id, profile_id').in('open_id', members.map((m) => m.openId).concat('-')), 'load people') as { open_id: string; profile_id: string | null }[];
  const byOpen = new Map(people.map((p) => [p.open_id, p.profile_id]));
  for (const m of members) await addMember(ctx, project.id, { profileId: byOpen.get(m.openId) ?? null, openId: m.openId, name: m.name }, 'group');
  const current = must(await ctx.db.from('project_members').select('id, open_id').eq('project_id', project.id).eq('source', 'group'), 'load members') as { id: string; open_id: string | null }[];
  const still = new Set(members.map((m) => m.openId));
  const left = current.filter((c) => c.open_id && !still.has(c.open_id)).map((c) => c.id);
  if (left.length) await ctx.db.from('project_members').delete().in('id', left);
}

/** Why this group cannot belong to the project with this code (null = it can). */
async function chatProblem(ctx: Ctx, w: WorkEnv, chatId: string, code: string, projectId: string | null): Promise<string | null> {
  const chat = must(await ctx.db.from('lark_chats').select('chat_id, name, mode, active').eq('chat_id', chatId).maybeSingle(), 'load chat') as { chat_id: string; name: string; mode: string; active: boolean } | null;
  if (!chat || !chat.active || chat.mode !== w.cfg.mode) return 'Bot chưa ở trong group này. Thêm bot vào group trên Lark rồi tải lại danh sách.';
  const others = must(await ctx.db.from('lark_tasks').select('id, code, name, chat_id, state').eq('kind', 'parent').is('deleted_at', null), 'load projects') as { id: string; code: string; name: string; chat_id: string | null; state: string }[];
  const holder = others.find((p) => p.id !== projectId && p.chat_id === chat.chat_id && p.state !== 'cancelled');
  if (holder) return `Group "${chat.name}" đang gắn với dự án ${holder.code} (${holder.name}).`;
  const clash = chatCodeConflict(chat.name, code, others.filter((p) => p.id !== projectId).map((p) => p.code));
  if (clash) return `Tên group "${chat.name}" mang mã ${clash} của dự án khác. Chọn group có mã ${normalizeProjectCode(code)}.`;
  return null;
}

async function bindChat(ctx: Ctx, w: WorkEnv, project: WorkRow, chatId: string): Promise<WorkRow> {
  const problem = await chatProblem(ctx, w, chatId, project.code ?? '', project.id);
  if (problem) throw new ApiError(400, 'invalid', problem);
  const chat = must(await ctx.db.from('lark_chats').select('chat_id, name').eq('chat_id', chatId).single(), 'load chat') as { chat_id: string; name: string };
  const row = must(
    await ctx.db.from('lark_tasks').update({ chat_id: chat.chat_id, chat_name: chat.name, chat_status: 'linked', chat_warned_at: null }).eq('id', project.id).select(WORK_COLS).single(),
    'link chat',
  ) as WorkRow;
  await tryLark('sync members', () => syncMembersFromChat(ctx, w, row));
  const pm = await pmOf(ctx, w, row);
  await sendWork(ctx, w, { kind: 'project_linked', project: row, to: 'group', key: `linked|${row.id}|${chat.chat_id}`, message: projectLinkedMessage({ ...pRef(row), dueDate: row.due_date, pmName: pm.name, pmOpenId: pm.openId }) });
  return row;
}

async function warnBotMissing(ctx: Ctx, w: WorkEnv, project: WorkRow) {
  if (project.chat_status !== 'missing' || project.chat_warned_at) return false;
  const pm = await pmOf(ctx, w, project);
  await sendWork(ctx, w, { kind: 'bot_missing', project, to: pm, key: `bot_missing|${project.id}|${w.today}`, message: botMissingMessage(pRef(project), projectLink(w, project)) });
  await ctx.db.from('lark_tasks').update({ chat_warned_at: new Date(ctx.now()).toISOString() }).eq('id', project.id);
  return true;
}

/** "Kiểm tra lại": links the project to a group whose name contains its code, if the bot is in one. */
export async function checkProjectChat(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const project = await loadRow(ctx, String(body.project_id ?? ''));
  if (!project || project.kind !== 'parent') throw new ApiError(404, 'not_found', 'Không tìm thấy dự án.');
  requireProjectPm(user, project);
  const { chats } = await listChats(ctx, user, { refresh: true });
  const chosen = body.chat_id ? chats.find((c) => c.chat_id === body.chat_id) : chats.find((c) => chatMatchesCode(c.name, project.code));
  if (!chosen) {
    if (project.chat_status !== 'missing') await ctx.db.from('lark_tasks').update({ chat_status: 'missing' }).eq('id', project.id);
    return { linked: false, chats };
  }
  const row = await bindChat(ctx, w, project, chosen.chat_id);
  return { linked: true, project: row, chats };
}

// ------------------------------------------------------------------------------- projects --------

export async function createProject(ctx: Ctx, user: Profile, body: Record<string, unknown>, via: 'web' | 'bot' = 'web') {
  if (user.role !== 'pm') throw new ApiError(403, 'forbidden', 'Chỉ PM mới tạo được dự án.');
  const w = await workEnv(ctx);
  const code = normalizeProjectCode(String(body.code ?? ''));
  const name = String(body.name ?? '').trim();
  const startDate = String(body.start_date || w.today);
  const dueDate = String(body.due_date ?? '');
  const existing = must(await ctx.db.from('lark_tasks').select('code').eq('kind', 'parent').is('deleted_at', null), 'load codes') as { code: string }[];
  const errors = [...checkProjectCode(code, existing.map((e) => e.code))];
  if (!name) errors.push('Thiếu tên dự án.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) errors.push('Thiếu deadline dự án.');
  else {
    if (dueDate <= startDate) errors.push('Deadline dự án phải sau ngày bắt đầu.');
    if (dueDate < w.today) errors.push('Deadline dự án đã qua.');
  }
  if (body.chat_id) {
    const problem = await chatProblem(ctx, w, String(body.chat_id), String(body.code ?? ''), null);
    if (problem) errors.push(problem);
  }
  const fromQuote = body.quote_id ? await quoteForLink(ctx, String(body.quote_id), user) : null;
  if (fromQuote?.errors.length) errors.push(...fromQuote.errors);
  if (errors.length) throw new ApiError(400, 'invalid', errors.join(' '));
  const pm = await personOf(ctx, w, user.id);
  let guid: string | null = null;
  let url: string | null = null;
  const title = projectTitle(code, name);
  if (w.cfg.mode === 'live') {
    if (!w.api) throw new ApiError(400, 'lark_config', 'Chưa có App ID / App Secret của Lark (Admin → Kết nối Lark).');
    try {
      const t = await w.api.createTask({
        summary: title,
        description: String(body.description ?? ''),
        due: dueToLark(dueDate),
        members: pm.openId ? [{ id: pm.openId, type: 'user', role: 'assignee' }] : [],
        client_token: crypto.randomUUID(),
      });
      guid = t.guid;
      url = t.url ?? null;
    } catch (e) {
      throw new ApiError(502, 'lark', `Lark chưa tạo được dự án: ${(e as Error).message}`);
    }
  }
  const row = must(
    await ctx.db
      .from('lark_tasks')
      .insert({
        kind: 'parent',
        code,
        name,
        client: String(body.client ?? '').trim() || null,
        description: String(body.description ?? '').trim() || null,
        assignee_open_id: pm.openId,
        assignee_name: pm.name,
        pm_id: user.id,
        start_date: startDate,
        due_date: dueDate,
        original_due_date: dueDate,
        kpi_due_date: dueDate,
        mode: w.cfg.mode,
        lark_guid: guid,
        lark_url: url,
        lark_title: title,
        state: 'active',
        color: String(body.color ?? '') || colorFor(existing.length),
        chat_status: 'missing',
        source: via,
        created_by: user.id,
        synced_at: w.cfg.mode === 'live' ? new Date(ctx.now()).toISOString() : null,
      })
      .select(WORK_COLS)
      .single(),
    'save project',
  ) as WorkRow;
  let out = row;
  if (body.chat_id) out = await bindChat(ctx, w, row, String(body.chat_id));
  else await warnBotMissing(ctx, w, row);
  for (const id of Array.isArray(body.member_ids) ? body.member_ids.map(String) : []) await inviteMember(ctx, w, out, id, user);
  if (fromQuote) await saveQuoteLink(ctx, out.id, fromQuote.id, user);
  return { project: out };
}

/** 1.7 · Load a quote a PM wants to turn into (or attach to) a project, with the reasons it cannot be. */
async function quoteForLink(ctx: Ctx, quoteId: string, user: Profile): Promise<{ id: string; code: string; errors: string[] }> {
  const q = must(await ctx.db.from('quotes').select('id, code, outcome, source, handover_pm').eq('id', quoteId).maybeSingle(), 'load quote') as
    | { id: string; code: string; outcome: QuoteOutcome | null; source: 'app' | 'import'; handover_pm: string | null }
    | null;
  if (!q) throw new ApiError(404, 'quote_not_found', 'Không tìm thấy báo giá.');
  const linked = must(await ctx.db.from('project_quotes').select('project_id').eq('quote_id', q.id).maybeSingle(), 'quote link') as { project_id: string } | null;
  return { id: q.id, code: q.code, errors: quoteLinkErrors({ outcome: q.outcome, source: q.source, handoverPm: q.handover_pm, linked: !!linked }, user) };
}

async function saveQuoteLink(ctx: Ctx, projectId: string, quoteId: string, user: Profile) {
  const res = await ctx.db.from('project_quotes').insert({ project_id: projectId, quote_id: quoteId, linked_by: user.id });
  if (res.error && /duplicate|unique/i.test(res.error.message)) throw new ApiError(409, 'linked', 'Báo giá này đã thuộc một dự án.');
  must(res, 'link quote');
}

/** 1.7 · Attach a won quote to an existing project (a second quote, an add-on). */
export async function linkQuote(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const project = await loadRow(ctx, String(body.project_id ?? ''));
  if (!project || project.kind !== 'parent') throw new ApiError(404, 'not_found', 'Không tìm thấy dự án.');
  requireProjectPm(user, project);
  if (project.state !== 'active') throw new ApiError(409, 'closed', 'Dự án đã đóng.');
  const q = await quoteForLink(ctx, String(body.quote_id ?? ''), user);
  if (q.errors.length) throw new ApiError(400, 'invalid', q.errors.join(' '));
  await saveQuoteLink(ctx, project.id, q.id, user);
  return { ok: true, quote: q.code };
}

export async function updateProject(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const project = await loadRow(ctx, String(body.project_id ?? ''));
  if (!project || project.kind !== 'parent') throw new ApiError(404, 'not_found', 'Không tìm thấy dự án.');
  requireProjectPm(user, project);
  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'client', 'description', 'color'] as const) if (body[k] !== undefined) patch[k] = String(body[k]).trim() || (k === 'name' ? project.name : null);
  if (body.due_date !== undefined && body.due_date !== project.due_date) {
    const to = String(body.due_date);
    const reason = String(body.reason ?? '') as ExtendReason;
    const kids = must(await ctx.db.from('lark_tasks').select('code, due_date, state').eq('parent_id', project.id).is('deleted_at', null), 'load tasks') as { code: string; due_date: string; state: string }[];
    const after = kids.filter((k) => (k.state === 'doing' || k.state === 'changes' || k.state === 'review') && k.due_date > to);
    const errs: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) errs.push('Deadline không hợp lệ.');
    else if (to <= project.start_date) errs.push('Deadline dự án phải sau ngày bắt đầu.');
    if (reason !== 'scope' && reason !== 'quality') errs.push('Chọn lý do đổi deadline.');
    if (after.length) errs.push(`Các task ${after.map((a) => a.code).join(', ')} có deadline sau ngày mới: đổi deadline các task đó trước.`);
    if (errs.length) throw new ApiError(400, 'invalid', errs.join(' '));
    patch.due_date = to;
    patch.kpi_due_date = reason === 'scope' ? to : project.kpi_due_date;
    must(await ctx.db.from('task_extensions').insert({ task_id: project.id, from_date: project.due_date, to_date: to, reason, note: String(body.note ?? '') || null, created_by: user.id }), 'save extension');
    if (project.lark_guid && w.api) await tryLark('project due', () => w.api!.patchTask(project.lark_guid!, { due: dueToLark(to) }, ['due']));
  }
  if (body.name !== undefined && project.lark_guid && w.api) await tryLark('project title', () => w.api!.patchTask(project.lark_guid!, { summary: projectTitle(project.code, String(body.name)) }, ['summary']));
  const row = Object.keys(patch).length ? (must(await ctx.db.from('lark_tasks').update(patch).eq('id', project.id).select(WORK_COLS).single(), 'save project') as WorkRow) : project;
  if (body.chat_id && body.chat_id !== project.chat_id) return { project: await bindChat(ctx, w, row, String(body.chat_id)) };
  return { project: row };
}

export async function cancelProject(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const project = await loadRow(ctx, String(body.project_id ?? ''));
  if (!project || project.kind !== 'parent') throw new ApiError(404, 'not_found', 'Không tìm thấy dự án.');
  requireProjectPm(user, project);
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw new ApiError(400, 'invalid', 'Ghi lý do huỷ dự án.');
  if (project.state === 'cancelled') return { ok: true };
  const stamp = new Date(ctx.now()).toISOString();
  must(await ctx.db.from('lark_tasks').update({ state: 'cancelled', cancel_reason: reason, cancelled_at: stamp, closed_at: stamp }).eq('id', project.id), 'cancel project');
  must(
    await ctx.db.from('lark_tasks').update({ state: 'cancelled', cancel_reason: `Dự án huỷ: ${reason}`, cancelled_at: stamp, closed_at: stamp }).eq('parent_id', project.id).in('state', ['doing', 'review', 'changes']),
    'cancel tasks',
  );
  await sendWork(ctx, w, { kind: 'project_cancelled', project, to: 'group', key: `project_cancelled|${project.id}`, message: { tone: 'grey', title: `🗑️ Dự án ${project.code} đã huỷ`, lines: [{ icon: '📌', label: 'Dự án', text: projectTitle(project.code, project.name) }, { icon: 'ℹ️', label: 'Lý do', text: reason }] } });
  return { ok: true };
}

/** PM invites people (they accept or decline in their Inbox) or removes members. */
export async function setMembers(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const project = await loadRow(ctx, String(body.project_id ?? ''));
  if (!project || project.kind !== 'parent') throw new ApiError(404, 'not_found', 'Không tìm thấy dự án.');
  requireProjectPm(user, project);
  let invited = 0;
  for (const id of Array.isArray(body.add_ids) ? body.add_ids.map(String) : []) if (await inviteMember(ctx, w, project, id, user)) invited++;
  const remove = Array.isArray(body.remove_ids) ? body.remove_ids.map(String) : [];
  if (remove.length) {
    const busy = must(await ctx.db.from('lark_tasks').select('code, assignee_id').eq('parent_id', project.id).in('assignee_id', remove).in('state', ['doing', 'review', 'changes']), 'load tasks') as { code: string }[];
    if (busy.length) throw new ApiError(400, 'invalid', `Còn task đang mở (${busy.map((b) => b.code).join(', ')}): giao lại hoặc huỷ trước khi bỏ thành viên.`);
    must(await ctx.db.from('project_members').delete().eq('project_id', project.id).in('profile_id', remove).neq('source', 'group'), 'remove members');
  }
  return { ok: true, invited };
}

async function reopenProjectIfDone(ctx: Ctx, project: WorkRow) {
  if (project.state === 'done') await ctx.db.from('lark_tasks').update({ state: 'active', closed_at: null }).eq('id', project.id);
}

/** PRD 5.4: the project closes itself once every task that is not cancelled has been approved. */
async function maybeCloseProject(ctx: Ctx, w: WorkEnv, projectId: string) {
  const project = await loadRow(ctx, projectId);
  if (!project || project.state !== 'active') return;
  const kids = must(await ctx.db.from('lark_tasks').select('state, kpi_due_date, accepted_at').eq('parent_id', projectId).is('deleted_at', null), 'load tasks') as { state: TaskStage; kpi_due_date: string; accepted_at: string | null }[];
  const live = kids.filter((k) => k.state !== 'cancelled');
  if (!live.length || live.some((k) => k.state !== 'done')) return;
  must(await ctx.db.from('lark_tasks').update({ state: 'done', closed_at: new Date(ctx.now()).toISOString() }).eq('id', projectId).eq('state', 'active'), 'close project');
  const onTime = live.filter((k) => kpiStatus({ state: k.state, kpiDueDate: k.kpi_due_date, acceptedAt: k.accepted_at ? Date.parse(k.accepted_at) : null, pendingAt: null }, ctx.now(), w.cfg.timeZone) === 'on_time').length;
  await sendWork(ctx, w, { kind: 'project_done', project, to: 'group', key: `project_done|${projectId}|${w.today}`, message: projectDoneMessage(pRef(project), live.length, onTime) });
}

// ---------------------------------------------------------------------------------- tasks --------

async function nextSeq(ctx: Ctx, projectId: string): Promise<number> {
  for (let i = 0; i < 6; i++) {
    const cur = must(await ctx.db.from('lark_tasks').select('next_seq').eq('id', projectId).single(), 'load counter') as { next_seq: number };
    const upd = must(await ctx.db.from('lark_tasks').update({ next_seq: cur.next_seq + 1 }).eq('id', projectId).eq('next_seq', cur.next_seq).select('id'), 'take number') as unknown[];
    if (upd.length) return cur.next_seq;
  }
  throw new ApiError(409, 'conflict', 'Đang có người tạo task cùng lúc, thử lại.');
}

export async function createTask(ctx: Ctx, user: Profile, body: Record<string, unknown>, via: 'web' | 'bot' = 'web') {
  const w = await workEnv(ctx);
  const project = body.project_id ? await loadRow(ctx, String(body.project_id)) : await loadProjectByCode(ctx, String(body.project_code ?? ''));
  if (!project || project.kind !== 'parent') throw new ApiError(404, 'not_found', `Không tìm thấy dự án ${String(body.project_code ?? '')}.`.trim());
  requireProjectPm(user, project);
  if (project.state === 'cancelled') throw new ApiError(400, 'invalid', 'Dự án đã huỷ.');
  const name = String(body.name ?? '').trim();
  const output = String(body.expected_output ?? '').trim();
  const startDate = String(body.start_date || (project.start_date > w.today ? project.start_date : w.today));
  const dueDate = String(body.due_date ?? '');
  const tier = ['short', 'medium', 'long'].includes(String(body.tier)) ? (String(body.tier) as ReminderTier) : null;
  let person: Person = { openId: null, name: '' };
  let assigneeId: string | null = body.assignee_id ? String(body.assignee_id) : null;
  if (assigneeId) person = await personOf(ctx, w, assigneeId);
  else if (body.assignee_open_id) {
    person = { openId: String(body.assignee_open_id), name: String(body.assignee_name ?? '') };
    assigneeId = await profileIdOfOpenId(ctx, person.openId);
  }
  const errors: string[] = [];
  if (!name) errors.push('Thiếu tên task.');
  if (!output) errors.push('Thiếu kết quả cần nộp.');
  if (!person.openId && !assigneeId) errors.push('Chọn người thực hiện.');
  errors.push(...taskDateErrors({ startDate, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null }, { startDate: project.start_date, dueDate: project.due_date }, w.today));
  if (assigneeId && body.assignee_id) {
    const m = must(await ctx.db.from('project_members').select('status').eq('project_id', project.id).eq('profile_id', assigneeId).maybeSingle(), 'load member') as { status: string } | null;
    if (m?.status !== 'accepted') errors.push(`${person.name || 'Người này'} ${m?.status === 'invited' ? 'chưa nhận lời mời vào dự án' : m?.status === 'declined' ? 'đã từ chối tham gia dự án' : 'chưa là thành viên dự án: mời vào dự án trước'}.`);
  }
  if (errors.length) throw new ApiError(400, 'invalid', errors.join(' '));
  if (body.dry_run) return { ok: true, code: taskCode(project.code, project.next_seq) };
  const seq = await nextSeq(ctx, project.id);
  const code = taskCode(project.code, seq);
  let guid: string | null = null;
  let url: string | null = null;
  const title = taskTitle(code, name);
  if (w.cfg.mode === 'live') {
    if (!w.api) throw new ApiError(400, 'lark_config', 'Chưa có App ID / App Secret của Lark.');
    if (!project.lark_guid) throw new ApiError(400, 'invalid', `Dự án ${project.code} được tạo ở chế độ mô phỏng, không có trên Lark.`);
    try {
      const t = await w.api.createSubtask(project.lark_guid, {
        summary: title,
        description: [String(body.description ?? ''), `Kết quả cần nộp: ${output}`].filter(Boolean).join('\n\n'),
        due: dueToLark(dueDate),
        members: person.openId && !person.openId.startsWith('sim:') ? [{ id: person.openId, type: 'user', role: 'assignee' }] : [],
        client_token: crypto.randomUUID(),
      });
      guid = t.guid;
      url = t.url ?? null;
    } catch (e) {
      throw new ApiError(502, 'lark', `Lark chưa tạo được task: ${(e as Error).message}`);
    }
  }
  const row = must(
    await ctx.db
      .from('lark_tasks')
      .insert({
        kind: 'child',
        parent_id: project.id,
        parent_code: project.code,
        code,
        seq,
        name,
        description: String(body.description ?? '').trim() || null,
        expected_output: output,
        assignee_open_id: person.openId,
        assignee_name: person.name || null,
        assignee_id: assigneeId,
        start_date: startDate,
        due_date: dueDate,
        original_due_date: dueDate,
        kpi_due_date: dueDate,
        tier,
        state: 'doing',
        mode: w.cfg.mode,
        lark_guid: guid,
        lark_url: url,
        lark_title: title,
        source: via,
        created_by: user.id,
        synced_at: w.cfg.mode === 'live' ? new Date(ctx.now()).toISOString() : null,
      })
      .select(WORK_COLS)
      .single(),
    'save task',
  ) as WorkRow;
  await addMember(ctx, project.id, { profileId: assigneeId, openId: person.openId, name: person.name }, 'task');
  await reopenProjectIfDone(ctx, project);
  await sendWork(ctx, w, { kind: 'task_created', project, task: row, to: 'group', key: `task_created|${row.id}`, message: taskCreatedMessage(pRef(project), tRef(row), taskLink(w, project, row)) });
  return { task: row };
}

export async function updateTask(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  requireProjectPm(user, project);
  if (task.state === 'done' || task.state === 'cancelled') throw new ApiError(400, 'invalid', 'Task đã đóng.');
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined && String(body.name).trim()) patch.name = String(body.name).trim();
  if (body.expected_output !== undefined && String(body.expected_output).trim()) patch.expected_output = String(body.expected_output).trim();
  if (body.description !== undefined) patch.description = String(body.description).trim() || null;
  if (body.tier !== undefined) patch.tier = ['short', 'medium', 'long'].includes(String(body.tier)) ? body.tier : null;
  if (body.assignee_id && body.assignee_id !== task.assignee_id) {
    const m = must(await ctx.db.from('project_members').select('status').eq('project_id', project.id).eq('profile_id', String(body.assignee_id)).maybeSingle(), 'load member') as { status: string } | null;
    if (m?.status !== 'accepted') throw new ApiError(400, 'invalid', 'Chỉ giao được cho thành viên đã nhận lời mời vào dự án.');
    const p = await personOf(ctx, w, String(body.assignee_id));
    Object.assign(patch, { assignee_id: String(body.assignee_id), assignee_open_id: p.openId, assignee_name: p.name, progress: null, progress_note: null });
    await addMember(ctx, project.id, { profileId: String(body.assignee_id), openId: p.openId, name: p.name }, 'task');
    if (task.lark_guid && w.api && p.openId && !p.openId.startsWith('sim:')) await tryLark('assignee', () => w.api!.patchTask(task.lark_guid!, { members: [{ id: p.openId, type: 'user', role: 'assignee' }] }, ['members']));
  }
  if (patch.name && task.lark_guid && w.api) await tryLark('title', () => w.api!.patchTask(task.lark_guid!, { summary: taskTitle(task.code, String(patch.name)) }, ['summary']));
  const row = Object.keys(patch).length ? (must(await ctx.db.from('lark_tasks').update(patch).eq('id', task.id).select(WORK_COLS).single(), 'save task') as WorkRow) : task;
  return { task: row };
}

async function latestSubmission(ctx: Ctx, taskId: string): Promise<Submission | null> {
  return must(await ctx.db.from('task_submissions').select(SUB_COLS).eq('task_id', taskId).order('round', { ascending: false }).limit(1).maybeSingle(), 'load submission') as Submission | null;
}

function cleanFiles(raw: unknown, taskId: string): Submission['files'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => f as { path?: string; name?: string; size?: number })
    .filter((f) => typeof f.path === 'string' && f.path.startsWith(`${taskId}/`) && !f.path.includes('..'))
    .map((f) => ({ path: String(f.path), name: String(f.name ?? f.path!.split('/').pop()), size: Number(f.size ?? 0) }))
    .slice(0, 20);
}

/** PRD 6.3–6.4: the assignee submits with at least one link or file; the task waits for the PM. */
export async function submitTask(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  const actor = actorOf(user, task, project);
  const evidence = { links: cleanLinks(body.links), files: cleanFiles(body.files, task.id) };
  const note = String(body.note ?? '').trim() || null;
  const last = await latestSubmission(ctx, task.id);
  // Marked Completed on Lark without evidence: the assignee adds it to that pending submission.
  if (task.state === 'review' && actor.isAssignee && last && !last.decision && !hasEvidence(last)) {
    const errs = evidenceErrors(evidence);
    if (errs.length) throw new ApiError(400, 'invalid', errs.join(' '));
    must(await ctx.db.from('task_submissions').update({ links: evidence.links, files: evidence.files, note }).eq('id', last.id), 'save evidence');
    const pm = await pmOf(ctx, w, project);
    await sendWork(ctx, w, { kind: 'submitted', project, task, to: 'group', key: `submitted|${task.id}|${last.round}`, message: submittedMessage(pRef(project), tRef(task), pm, taskLink(w, project, task)) });
    return { ok: true, round: last.round };
  }
  refuse('submit', task.state, actor);
  const errs = evidenceErrors(evidence);
  if (errs.length) throw new ApiError(400, 'invalid', errs.join(' '));
  const round = (last?.round ?? 0) + 1;
  const stamp = new Date(ctx.now()).toISOString();
  must(await ctx.db.from('task_submissions').insert({ task_id: task.id, round, via: 'web', submitted_by: user.id, submitted_at: stamp, note, links: evidence.links, files: evidence.files }), 'save submission');
  must(await ctx.db.from('lark_tasks').update({ state: 'review', review_since: stamp, completed_at: stamp }).eq('id', task.id).in('state', ['doing', 'changes']), 'save task');
  if (task.lark_guid && w.api) await tryLark('complete', () => w.api!.patchTask(task.lark_guid!, { completed_at: String(ctx.now()) }, ['completed_at']));
  const pm = await pmOf(ctx, w, project);
  await sendWork(ctx, w, { kind: 'submitted', project, task, to: 'group', key: `submitted|${task.id}|${round}`, message: submittedMessage(pRef(project), tRef(task), pm, taskLink(w, project, task)) });
  return { ok: true, round };
}

/** PRD 6.4: approve, or send back with feedback (and optionally a new deadline with its reason). */
export async function reviewTask(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  const actor = actorOf(user, task, project);
  const approve = body.decision === 'approve';
  refuse(approve ? 'approve' : 'request_changes', task.state, actor);
  const sub = await latestSubmission(ctx, task.id);
  if (!sub || sub.decision) throw new ApiError(409, 'conflict', 'Không có lần nộp nào đang chờ duyệt.');
  const stamp = new Date(ctx.now()).toISOString();
  if (approve) {
    if (!hasEvidence(sub)) throw new ApiError(400, 'invalid', 'Lần nộp này chưa có bằng chứng: chờ nhân sự thêm link hoặc file, hoặc bấm Yêu cầu sửa.');
    must(await ctx.db.from('task_submissions').update({ decision: 'approved', decided_by: user.id, decided_at: stamp, feedback: String(body.feedback ?? '').trim() || null }).eq('id', sub.id).is('decision', null), 'save decision');
    must(
      await ctx.db.from('lark_tasks').update({ state: 'done', accepted_at: sub.submitted_at, approved_at: stamp, approved_by: user.id, closed_at: stamp, progress: null, progress_note: null }).eq('id', task.id).eq('state', 'review'),
      'save task',
    );
    await sendWork(ctx, w, { kind: 'approved', project, task, to: 'group', key: `approved|${task.id}|${sub.round}`, message: approvedMessage(pRef(project), tRef(task)) });
    await maybeCloseProject(ctx, w, project.id);
    return { ok: true, state: 'done' };
  }
  const feedback = String(body.feedback ?? '').trim();
  if (!feedback) throw new ApiError(400, 'invalid', 'Ghi góp ý: cần cải thiện gì, sửa gì.');
  let dates = { dueDate: task.due_date, kpiDueDate: task.kpi_due_date ?? task.due_date };
  let newDue: string | null = null;
  if (body.extend_to) {
    newDue = String(body.extend_to);
    const reason = String(body.extend_reason ?? '');
    const errs = extensionErrors({ dueDate: task.due_date }, newDue, reason, project.due_date, w.today);
    if (errs.length) throw new ApiError(400, 'invalid', errs.join(' '));
    dates = applyExtension(dates, newDue, reason as ExtendReason);
    must(await ctx.db.from('task_extensions').insert({ task_id: task.id, from_date: task.due_date, to_date: newDue, reason, note: feedback, created_by: user.id }), 'save extension');
  }
  must(await ctx.db.from('task_submissions').update({ decision: 'changes', decided_by: user.id, decided_at: stamp, feedback }).eq('id', sub.id).is('decision', null), 'save decision');
  must(
    await ctx.db
      .from('lark_tasks')
      .update({ state: 'changes', review_since: null, completed_at: null, due_date: dates.dueDate, kpi_due_date: dates.kpiDueDate, progress: null, progress_note: null })
      .eq('id', task.id)
      .eq('state', 'review'),
    'save task',
  );
  if (task.lark_guid && w.api) {
    const fields = newDue ? ['completed_at', 'due'] : ['completed_at'];
    await tryLark('reopen', () => w.api!.patchTask(task.lark_guid!, { completed_at: '0', ...(newDue ? { due: dueToLark(newDue) } : {}) }, fields));
  }
  const t2 = { ...task, due_date: dates.dueDate };
  await sendWork(ctx, w, { kind: 'changes', project, task, to: 'group', key: `changes|${task.id}|${sub.round}`, message: changesGroupMessage(pRef(project), tRef(task), newDue) });
  await sendWork(ctx, w, { kind: 'changes_dm', project, task, to: assignee(task), key: `changes_dm|${task.id}|${sub.round}`, message: changesDmMessage(pRef(project), tRef(t2), feedback, newDue, taskLink(w, project, task)) });
  return { ok: true, state: 'changes' };
}

export async function extendTask(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  refuse('extend', task.state, actorOf(user, task, project));
  const to = String(body.to ?? '');
  const reason = String(body.reason ?? '');
  const errs = extensionErrors({ dueDate: task.due_date }, to || null, reason, project.due_date, w.today);
  if (errs.length) throw new ApiError(400, 'invalid', errs.join(' '));
  const dates = applyExtension({ dueDate: task.due_date, kpiDueDate: task.kpi_due_date ?? task.due_date }, to, reason as ExtendReason);
  const ext = must(
    await ctx.db.from('task_extensions').insert({ task_id: task.id, from_date: task.due_date, to_date: to, reason, note: String(body.note ?? '').trim() || null, created_by: user.id }).select('id').single(),
    'save extension',
  ) as { id: string };
  must(await ctx.db.from('lark_tasks').update({ due_date: dates.dueDate, kpi_due_date: dates.kpiDueDate }).eq('id', task.id), 'save task');
  if (task.lark_guid && w.api) await tryLark('due', () => w.api!.patchTask(task.lark_guid!, { due: dueToLark(to) }, ['due']));
  await sendWork(ctx, w, { kind: 'extended', project, task, to: 'group', key: `extended|${ext.id}`, message: extendedMessage(pRef(project), tRef(task), task.due_date, to, reason as ExtendReason) });
  return { ok: true, due_date: dates.dueDate, kpi_due_date: dates.kpiDueDate };
}

export async function cancelTask(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  refuse('cancel', task.state, actorOf(user, task, project));
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw new ApiError(400, 'invalid', 'Ghi lý do huỷ task.');
  const stamp = new Date(ctx.now()).toISOString();
  must(await ctx.db.from('lark_tasks').update({ state: 'cancelled', cancel_reason: reason, cancelled_at: stamp, closed_at: stamp }).eq('id', task.id), 'cancel task');
  await sendWork(ctx, w, { kind: 'cancelled', project, task, to: 'group', key: `cancelled|${task.id}`, message: cancelledMessage(pRef(project), tRef(task), reason) });
  await maybeCloseProject(ctx, w, project.id);
  return { ok: true };
}

export async function reopenTask(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  refuse('reopen', task.state, actorOf(user, task, project));
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw new ApiError(400, 'invalid', 'Ghi lý do mở lại.');
  must(await ctx.db.from('lark_tasks').update({ state: 'doing', accepted_at: null, approved_at: null, approved_by: null, closed_at: null, completed_at: null }).eq('id', task.id).eq('state', 'done'), 'reopen task');
  await reopenProjectIfDone(ctx, project);
  if (task.lark_guid && w.api) await tryLark('reopen', () => w.api!.patchTask(task.lark_guid!, { completed_at: '0' }, ['completed_at']));
  await sendWork(ctx, w, { kind: 'reopened', project, task, to: 'group', key: `reopened|${task.id}|${ctx.now()}`, message: reopenedMessage(pRef(project), tRef(task), reason) });
  return { ok: true };
}

// --------------------------------------------------------------------------- progress (7.2) --------

async function recordProgress(ctx: Ctx, w: WorkEnv, task: WorkRow, project: WorkRow, answer: Progress, reason: string) {
  const stamp = new Date(ctx.now()).toISOString();
  must(await ctx.db.from('lark_tasks').update({ progress: answer, progress_note: reason || null, progress_at: stamp }).eq('id', task.id), 'save progress');
  const open = must(await ctx.db.from('task_checkins').select('id').eq('task_id', task.id).not('sent_at', 'is', null).is('answered_at', null).order('pct', { ascending: false }).limit(1), 'load check-in') as { id: number }[];
  if (open.length) await ctx.db.from('task_checkins').update({ answer, answer_reason: reason || null, answered_at: stamp }).eq('id', open[0].id);
  if (answer === 'blocked') {
    const pm = await pmOf(ctx, w, project);
    await sendWork(ctx, w, { kind: 'blocked', project, task, to: pm, key: `blocked|${task.id}|${stamp}`, message: blockedMessage(pRef(project), tRef(task), reason, taskLink(w, project, task)) });
  }
}

export async function answerProgress(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const w = await workEnv(ctx);
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  refuse('progress', task.state, actorOf(user, task, project));
  const answer = String(body.answer ?? '') as Progress;
  if (!['on_plan', 'behind', 'blocked'].includes(answer)) throw new ApiError(400, 'invalid', 'Câu trả lời không hợp lệ.');
  const reason = String(body.reason ?? '').trim();
  if (answer === 'blocked' && !reason) throw new ApiError(400, 'invalid', 'Ghi lý do bị chặn để PM hỗ trợ.');
  await recordProgress(ctx, w, task, project, answer, reason);
  return { ok: true };
}

/** "Đã gỡ" by the assignee or "Đã xử lý" by the PM. */
export async function clearBlocked(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  const actor = actorOf(user, task, project);
  if (!actor.isAssignee && !actor.isProjectPm) throw new ApiError(403, 'forbidden', 'Chỉ người thực hiện hoặc PM của dự án.');
  must(await ctx.db.from('lark_tasks').update({ progress: 'on_plan', progress_note: null, progress_at: new Date(ctx.now()).toISOString() }).eq('id', task.id).eq('progress', 'blocked'), 'clear blocked');
  return { ok: true };
}

/** Card button on Lark (PRD 7.2). Only the assignee's own click counts. */
export async function progressFromCard(ctx: Ctx, operatorOpenId: string, value: Record<string, string>): Promise<BotMessage> {
  const w = await workEnv(ctx);
  const task = await loadRow(ctx, value.task ?? '');
  if (!task || task.kind !== 'child' || !task.parent_id) return { tone: 'grey', title: 'Không tìm thấy task', lines: [] };
  if (task.assignee_open_id !== operatorOpenId) return { tone: 'red', title: 'Chỉ người thực hiện mới trả lời được', lines: [] };
  if (task.state !== 'doing' && task.state !== 'changes') return { tone: 'grey', title: 'Task không còn ở trạng thái đang làm', lines: [] };
  const project = await loadRow(ctx, task.parent_id);
  if (!project) return { tone: 'grey', title: 'Không tìm thấy dự án', lines: [] };
  const answer = value.answer as Progress;
  if (!['on_plan', 'behind', 'blocked'].includes(answer)) return { tone: 'grey', title: 'Câu trả lời không hợp lệ', lines: [] };
  await recordProgress(ctx, w, task, project, answer, answer === 'blocked' ? 'Trả lời từ Lark, chưa ghi lý do' : '');
  const label = answer === 'on_plan' ? 'Đúng tiến độ' : answer === 'behind' ? 'Chậm' : 'Bị chặn';
  return {
    tone: answer === 'on_plan' ? 'green' : answer === 'behind' ? 'orange' : 'red',
    title: `Đã ghi nhận: ${task.code} · ${label}`,
    lines: [{ icon: '🔸', text: taskTitle(task.code, task.name) }, ...(answer === 'blocked' ? [{ icon: 'ℹ️', text: 'PM đã được báo. Ghi lý do trên Ops Hub để PM hỗ trợ nhanh hơn.' }] : [])],
  };
}

// ---------------------------------------------------------------------------------- files --------

const safeName = (n: string) => n.normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80) || 'file';

export async function evidenceUploadUrl(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  const actor = actorOf(user, task, project);
  if (!actor.isAssignee) throw new ApiError(403, 'forbidden', 'Chỉ người thực hiện mới tải bằng chứng lên được.');
  const size = Number(body.size ?? 0);
  if (size > MAX_EVIDENCE_BYTES) throw new ApiError(400, 'too_big', 'File quá 20 MB: tải lên Drive rồi dán link.');
  const path = `${task.id}/${crypto.randomUUID().slice(0, 8)}-${safeName(String(body.name ?? 'file'))}`;
  const { data, error } = await ctx.db.storage.from('task-evidence').createSignedUploadUrl(path);
  if (error || !data) throw new ApiError(500, 'storage', `Chưa tạo được link tải lên: ${error?.message ?? 'không rõ'}`);
  return { path: data.path ?? path, token: data.token, signedUrl: data.signedUrl };
}

export async function evidenceFileUrl(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const { task, project } = await loadTaskAndProject(ctx, String(body.task_id ?? ''));
  const path = String(body.path ?? '');
  if (!path.startsWith(`${task.id}/`)) throw new ApiError(400, 'invalid', 'File không thuộc task này.');
  const member = must(await ctx.db.from('project_members').select('id').eq('project_id', project.id).eq('profile_id', user.id).limit(1), 'load member') as unknown[];
  const allowed = ['pm', 'ceo', 'admin'].includes(user.role) || member.length > 0 || task.assignee_id === user.id;
  if (!allowed) throw new ApiError(403, 'forbidden', 'Bạn không xem được bằng chứng của dự án này.');
  const { data, error } = await ctx.db.storage.from('task-evidence').createSignedUrl(path, 600);
  if (error || !data) throw new ApiError(404, 'not_found', 'Không mở được file.');
  return { url: data.signedUrl };
}

// ------------------------------------------------------------------------------- bot (10.1) --------

interface WorkDraft {
  type: 'project' | 'task';
  code?: string;
  name: string;
  dueDate: string | null;
  chatId?: string | null;
  projectCode?: string;
  assigneeOpenId?: string | null;
  assigneeName?: string | null;
  expectedOutput?: string;
  pmProfileId: string;
}

/** Handles "/taomoi duan|task" (and the 1.5 forms) from a PM. Returns false when the text is not a command. */
export async function handleWorkCommand(
  ctx: Ctx,
  args: { sender: string; chatId: string | null; text: string; mentions: { key: string; openId: string; name: string }[]; reply: (m: BotMessage) => Promise<unknown> },
): Promise<boolean> {
  const w = await workEnv(ctx);
  const cmd = parseProjectCommand(args.text, args.mentions, ctx.now(), w.cfg.timeZone);
  if (cmd.kind === 'help') {
    await args.reply({ tone: 'blue', title: 'Hướng dẫn', lines: [{ icon: 'ℹ️', text: PROJECT_HELP_TEXT }] });
    return true;
  }
  const profileId = await profileIdOfOpenId(ctx, args.sender);
  const pm = profileId ? await loadProfile(ctx.db, profileId) : null;
  if (!pm || pm.role !== 'pm' || !pm.active) {
    await args.reply({ tone: 'red', title: 'Chỉ PM mới tạo được dự án và task', lines: [{ icon: 'ℹ️', text: 'Tài khoản Lark của bạn chưa liên kết với tài khoản PM trên Ops Hub. Nhờ Admin kiểm tra.' }] });
    return true;
  }
  if (cmd.errors.length) {
    await args.reply({ tone: 'red', title: cmd.kind === 'project' ? 'Chưa tạo dự án' : 'Chưa tạo task', lines: cmd.errors.map((e) => ({ icon: '❌', text: e })), note: 'Gõ "help" để xem cú pháp.' });
    return true;
  }
  let draft: WorkDraft;
  let preview: BotMessage;
  if (cmd.kind === 'project') {
    const existing = must(await ctx.db.from('lark_tasks').select('code').eq('kind', 'parent').is('deleted_at', null), 'load codes') as { code: string }[];
    const errs = [...checkProjectCode(cmd.code, existing.map((e) => e.code)), ...(cmd.name ? [] : ['Thiếu tên dự án.']), ...(cmd.dueDate ? [] : ['Thiếu deadline.'])];
    if (errs.length) {
      await args.reply({ tone: 'red', title: 'Chưa tạo dự án', lines: errs.map((e) => ({ icon: '❌', text: e })) });
      return true;
    }
    const chatId = args.chatId && !args.chatId.startsWith('oc_p2p') ? args.chatId : null;
    draft = { type: 'project', code: cmd.code, name: cmd.name, dueDate: cmd.dueDate, chatId, pmProfileId: pm.id };
    preview = {
      tone: 'blue',
      title: 'Xác nhận tạo dự án',
      lines: [{ icon: '📌', label: 'Dự án', text: projectTitle(cmd.code, cmd.name) }, { icon: '⏰', label: 'Deadline dự án', text: fmtDueDate(cmd.dueDate!) }, ...(chatId ? [{ icon: '💬', text: 'Dự án sẽ gắn với group này.' }] : [])],
    };
  } else {
    const project = await loadProjectByCode(ctx, cmd.projectCode);
    if (!project) {
      await args.reply({ tone: 'red', title: 'Chưa tạo task', lines: [{ icon: '❌', text: `Chưa có dự án ${cmd.projectCode}. Tạo dự án trước: /taomoi duan …` }] });
      return true;
    }
    const errs = [...(cmd.name ? [] : ['Thiếu tên task.']), ...(cmd.assigneeOpenId ? [] : ['Thiếu người thực hiện (@tag người đó).']), ...(cmd.dueDate ? [] : ['Thiếu deadline.']), ...(cmd.expectedOutput ? [] : ['Thiếu kết quả cần nộp (phần thứ 5).'])];
    if (cmd.dueDate && cmd.dueDate > project.due_date) errs.push(`Deadline sau deadline dự án (${fmtDueDate(project.due_date)}).`);
    if (errs.length) {
      await args.reply({ tone: 'red', title: 'Chưa tạo task', lines: errs.map((e) => ({ icon: '❌', text: e })) });
      return true;
    }
    draft = { type: 'task', projectCode: project.code, name: cmd.name, dueDate: cmd.dueDate, assigneeOpenId: cmd.assigneeOpenId, assigneeName: cmd.assigneeName, expectedOutput: cmd.expectedOutput, pmProfileId: pm.id };
    preview = {
      tone: 'blue',
      title: 'Xác nhận tạo task',
      lines: [
        { icon: '📌', label: 'Dự án', text: projectTitle(project.code, project.name) },
        { icon: '🔸', label: 'Task', text: `${cmd.name} (mã dự kiến ${taskCode(project.code, project.next_seq)})` },
        { icon: '👤', label: 'Người thực hiện', text: cmd.assigneeName ?? '', mentionOpenId: cmd.assigneeOpenId },
        { icon: '⏰', label: 'Deadline', text: fmtDueDate(cmd.dueDate!) },
        { icon: '🎯', label: 'Kết quả cần nộp', text: cmd.expectedOutput },
      ],
    };
  }
  const saved = must(await ctx.db.from('lark_drafts').insert({ open_id: args.sender, draft }).select('id').single(), 'save draft') as { id: string };
  await args.reply({
    ...preview,
    note: 'Bấm Xác nhận tạo (hoặc trả lời "xác nhận").',
    buttons: [
      { text: 'Xác nhận tạo', type: 'primary', value: { op: 'confirm', draft: saved.id } },
      { text: 'Huỷ', type: 'default', value: { op: 'cancel', draft: saved.id } },
    ],
  });
  return true;
}

export function isWorkDraft(d: unknown): d is WorkDraft {
  return !!d && typeof d === 'object' && ((d as WorkDraft).type === 'project' || (d as WorkDraft).type === 'task');
}

/** "Xác nhận tạo" on a 1.6 draft. */
export async function settleWorkDraft(ctx: Ctx, d: WorkDraft): Promise<BotMessage> {
  const pm = await loadProfile(ctx.db, d.pmProfileId);
  if (!pm || pm.role !== 'pm') return { tone: 'red', title: 'Chỉ PM mới tạo được', lines: [] };
  try {
    if (d.type === 'project') {
      const { project } = await createProject(ctx, pm, { code: d.code, name: d.name, due_date: d.dueDate, chat_id: d.chatId ?? undefined }, 'bot');
      return { tone: 'green', title: `✅ Đã tạo dự án ${project.code}`, lines: [{ icon: '📌', text: projectTitle(project.code, project.name) }, { icon: '⏰', label: 'Deadline', text: fmtDueDate(project.due_date) }] };
    }
    const created = (await createTask(ctx, pm, { project_code: d.projectCode, name: d.name, due_date: d.dueDate, assignee_open_id: d.assigneeOpenId, assignee_name: d.assigneeName, expected_output: d.expectedOutput }, 'bot')) as { task: WorkRow };
    const task = created.task;
    return { tone: 'green', title: `✅ Đã tạo task ${task.code}`, lines: [{ icon: '🔸', text: taskTitle(task.code, task.name) }, { icon: '⏰', label: 'Deadline', text: fmtDueDate(task.due_date) }] };
  } catch (e) {
    return { tone: 'red', title: 'Chưa tạo được', lines: [{ icon: '❌', text: (e as Error).message }] };
  }
}

// --------------------------------------------------------------------------- daily jobs (7) --------

export interface WorkTickResult {
  reminders: number;
  checkins: number;
  nudges: number;
  summaries: number;
  fromLark: number;
  warned: number;
  closed: number;
}

interface CheckinRow {
  task_id: string;
  pct: number;
  sent_at: string | null;
  answered_at: string | null;
}

function deriveTask(w: WorkEnv, t: WorkRow, checkins: CheckinRow[], pending: Submission | undefined): SummaryTask {
  const mine = checkins.filter((c) => c.task_id === t.id && c.sent_at).sort((a, b) => b.pct - a.pct)[0];
  const noUpdate = !!mine && !mine.answered_at && isNoUpdate(localDateKey(Date.parse(mine.sent_at!), w.cfg.timeZone), w.today, w.nowHM, w.cal);
  const h = taskHealth({ state: t.state as TaskStage, dueDate: t.due_date, progress: t.progress, progressNote: t.progress_note, noUpdate, hasEvidence: hasEvidence(pending) }, w.today);
  const day = (s: string | null | undefined) => (s ? localDateKey(Date.parse(s), w.cfg.timeZone) : null);
  return {
    code: t.code,
    name: t.name,
    state: t.state as TaskStage,
    dueDate: t.due_date,
    health: h.health,
    reason: h.reason,
    progress: t.progress,
    noUpdate,
    reviewSince: day(t.review_since),
    submittedOn: t.state === 'review' ? day(t.review_since) : null,
    approvedOn: day(t.approved_at),
  };
}

/**
 * Runs with the 15-minute job, after the Lark sync. Deadline reminders and progress questions go out
 * from the configured time (09:00); summaries at 08:30 and 17:30 on working days; `force` = now.
 */
export async function workTick(ctx: Ctx, api: LarkApi | null, opts: { force?: boolean } = {}): Promise<WorkTickResult> {
  const w = await workEnv(ctx, api);
  const res: WorkTickResult = { reminders: 0, checkins: 0, nudges: 0, summaries: 0, fromLark: 0, warned: 0, closed: 0 };
  const inWindow = !!opts.force || w.nowHM >= w.cfg.notifyTime;
  const workday = isWorkDay(w.today, w.cal);
  const projects = must(await ctx.db.from('lark_tasks').select(WORK_COLS).eq('kind', 'parent').is('deleted_at', null).eq('state', 'active'), 'load projects') as WorkRow[];
  if (!projects.length) return res;
  const ids = projects.map((p) => p.id);
  const tasks = must(await ctx.db.from('lark_tasks').select(WORK_COLS).eq('kind', 'child').is('deleted_at', null).in('parent_id', ids), 'load tasks') as WorkRow[];
  const openIds = tasks.filter((t) => ['doing', 'changes', 'review'].includes(t.state)).map((t) => t.id);
  const checkins = openIds.length ? (must(await ctx.db.from('task_checkins').select('task_id, pct, sent_at, answered_at').in('task_id', openIds), 'load check-ins') as CheckinRow[]) : [];
  const subs = openIds.length ? (must(await ctx.db.from('task_submissions').select(SUB_COLS).in('task_id', openIds).is('decision', null), 'load submissions') as Submission[]) : [];
  const pendingOf = new Map(subs.map((s) => [s.task_id, s]));

  for (const project of projects) {
    if (await warnBotMissing(ctx, w, project)) res.warned++;
    const kids = tasks.filter((t) => t.parent_id === project.id);
    for (const t of kids) {
      // Marked Completed on Lark (sync) while still open here → submission without evidence (PRD 6.3).
      if (t.completed_at && (t.state === 'doing' || t.state === 'changes')) {
        const last = await latestSubmission(ctx, t.id);
        const round = (last?.round ?? 0) + 1;
        const { error } = await ctx.db.from('task_submissions').insert({ task_id: t.id, round, via: 'lark', submitted_at: t.completed_at });
        if (!error) {
          must(await ctx.db.from('lark_tasks').update({ state: 'review', review_since: t.completed_at }).eq('id', t.id).in('state', ['doing', 'changes']), 'save task');
          t.state = 'review';
          t.review_since = t.completed_at;
          pendingOf.set(t.id, { id: '', task_id: t.id, round, via: 'lark', submitted_at: t.completed_at, note: null, links: [], files: [], decision: null });
          await sendWork(ctx, w, { kind: 'missing_evidence', project, task: t, to: assignee(t), key: `missing_evidence|${t.id}|${round}`, message: missingEvidenceMessage(tRef(t), taskLink(w, project, t)) });
          res.fromLark++;
        }
        continue;
      }
      if (!inWindow) continue;
      const r = reminderToday({ state: t.state as TaskStage, dueDate: t.due_date, startDate: t.start_date, tier: t.tier }, w.today);
      if (r && (await sendWork(ctx, w, { kind: 'reminder', project, task: t, to: 'group', key: `reminder|${t.id}|${w.today}`, message: deadlineMessage(pRef(project), tRef(t), r, taskLink(w, project, t)) }))) res.reminders++;
      const sent = checkins.filter((c) => c.task_id === t.id).map((c) => c.pct);
      const ci = checkinToSend({ state: t.state as TaskStage, startDate: t.start_date, dueDate: t.due_date, tier: t.tier }, sent, w.today, w.cal);
      if (ci) {
        const stamp = new Date(ctx.now()).toISOString();
        const { error } = await ctx.db.from('task_checkins').insert({ task_id: t.id, pct: ci.pct, due_date: ci.date, sent_at: stamp });
        if (!error) {
          checkins.push({ task_id: t.id, pct: ci.pct, sent_at: stamp, answered_at: null });
          if (await sendWork(ctx, w, { kind: 'checkin', project, task: t, to: assignee(t), key: `checkin|${t.id}|${ci.pct}`, message: checkinMessage(pRef(project), tRef(t), ci.pct, t.id, taskLink(w, project, t)) })) res.checkins++;
        }
      }
    }
  }

  // Per PM: review nudges (7.3) and summaries (7.6), on working days only.
  if (workday) {
    const byPm = new Map<string, WorkRow[]>();
    for (const p of projects) if (p.pm_id) byPm.set(p.pm_id, [...(byPm.get(p.pm_id) ?? []), p]);
    const morning = w.settings.summary_morning_time ?? '08:30';
    const evening = w.settings.summary_evening_time ?? '17:30';
    for (const [pmId, mine] of byPm) {
      const pm = await personOf(ctx, w, pmId);
      const kidsOf = (p: WorkRow) => tasks.filter((t) => t.parent_id === p.id);
      if (inWindow) {
        const waiting = mine.flatMap((p) => kidsOf(p).filter((t) => t.state === 'review' && t.review_since && reviewIsLate(localDateKey(Date.parse(t.review_since), w.cfg.timeZone), w.today, w.cal)));
        if (waiting.length) {
          const items = waiting.map((t) => ({ code: t.code, name: t.name, days: workDaysAfter(localDateKey(Date.parse(t.review_since!), w.cfg.timeZone), w.today, w.cal) }));
          if (await sendWork(ctx, w, { kind: 'review_nudge', project: null, to: pm, key: `review_nudge|${pmId}|${w.today}`, message: reviewNudgeMessage(items, link(w, '/cho-duyet')) })) res.nudges++;
        }
      }
      const wantMorning = opts.force || w.nowHM >= morning;
      const wantEvening = (opts.force || w.nowHM >= evening) && w.settings.summary_evening_on !== false;
      if (!wantMorning && !wantEvening) continue;
      const list: SummaryProject[] = mine.map((p) => {
        const derived = kidsOf(p).map((t) => deriveTask(w, t, checkins, pendingOf.get(t.id)));
        const roll = projectRollup({ state: 'active', startDate: p.start_date, dueDate: p.due_date }, derived.map((d) => ({ state: d.state, health: d.health })), w.today);
        return summarizeProject({ code: p.code, name: p.name, status: roll.status, reason: roll.reason }, derived, w.today, w.cal);
      });
      if (wantMorning && (await sendWork(ctx, w, { kind: 'summary_morning', project: null, to: pm, key: `summary_morning|${pmId}|${w.today}`, message: morningSummaryMessage(list, w.today, link(w, '/tom-tat')) }))) res.summaries++;
      if (wantEvening && (await sendWork(ctx, w, { kind: 'summary_evening', project: null, to: pm, key: `summary_evening|${pmId}|${w.today}`, message: eveningSummaryMessage(list, w.today, link(w, '/tom-tat')) }))) res.summaries++;
    }
  }

  // Close projects whose tasks were all approved by another path (e.g. data fixes).
  for (const p of projects) {
    const before = p.state;
    await maybeCloseProject(ctx, w, p.id);
    const after = await loadRow(ctx, p.id);
    if (after && after.state !== before) res.closed++;
  }
  if (w.cfg.mode === 'live' && w.api) for (const p of projects) await tryLark('members', () => syncMembersFromChat(ctx, w, p));
  return res;
}
