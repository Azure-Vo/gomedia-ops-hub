// S1 on Lark (brief A2.3). The bot takes "/taomoi" commands, checks the codes, shows a preview and creates
// the parent task / sub-task on Lark Tasks after "Xác nhận tạo". Every 15 minutes (pg_cron) the backend
// syncs open tasks from Lark; from 09:00 it sends at most one reminder per sub-task per day into the
// group, tagging the assignee, and confirms completion once the sub-task is Completed with valid codes.
// In simulation mode (no Lark app yet) the same flow runs without calling Lark: messages are stored and
// shown on the web page "S1 · Nhắc task Lark".
import {
  BotMessage,
  errorMessage,
  PROJECT_HELP_TEXT,
  LarkCodeRules,
  LarkDraft,
  larkTitle,
  localDateKey,
  normalizeCode,
  parentCodeOf,
  toLarkCard,
  toLocalParts,
  pad2,
  validateCodeRules,
  validateDraft,
  fmtDueDate,
} from '../../../src/domain/index';
import { Ctx, loadSettings, Profile } from './context';
import { ApiError, must, safeEqual } from './http';
import { handleWorkCommand, isWorkDraft, progressFromCard, settleWorkDraft, workTick } from './work';

// ----------------------------------------------------------------------------- configuration --------

export interface LarkConfig {
  mode: 'simulation' | 'live';
  apiBase: string;
  appId: string;
  appSecret: string | null;
  verificationToken: string | null;
  chatId: string;
  rules: LarkCodeRules;
  notifyD0: boolean;
  notifyTime: string;
  timeZone: string;
}

export async function loadLarkConfig(ctx: Ctx): Promise<LarkConfig> {
  const s = (await loadSettings(ctx.db)) as unknown as Record<string, unknown>;
  const { data: secrets } = await ctx.db.rpc('ops_lark_secrets');
  const sec = (secrets ?? {}) as { app_secret?: string | null; verification_token?: string | null };
  return {
    mode: s.lark_mode === 'live' ? 'live' : 'simulation',
    apiBase: (ctx.env.larkApiBase ?? String(s.lark_api_base ?? 'https://open.larksuite.com')).replace(/\/$/, ''),
    appId: String(s.lark_app_id ?? ''),
    appSecret: sec.app_secret || null,
    verificationToken: sec.verification_token || null,
    chatId: String(s.lark_chat_id ?? ''),
    rules: {
      parentPattern: String(s.lark_parent_pattern ?? '^[A-Z]{2}\\d{3}$'),
      childPattern: String(s.lark_child_pattern ?? '^{PARENT}-\\d{2}-S\\d{2}$'),
      parentExample: String(s.lark_parent_example ?? 'DA056'),
      childExample: String(s.lark_child_example ?? 'DA056-04-S44'),
    },
    notifyD0: !!s.lark_notify_d0,
    notifyTime: String(s.lark_notify_time ?? '09:00'),
    timeZone: String(s.timezone ?? 'Asia/Ho_Chi_Minh'),
  };
}

// --------------------------------------------------------------------------------- Lark API --------

export class LarkError extends Error {
  constructor(
    public code: number | string,
    message: string,
    public httpStatus = 0,
  ) {
    super(message);
  }
}

interface LarkTaskData {
  guid: string;
  summary?: string;
  description?: string;
  due?: { timestamp?: string; is_all_day?: boolean } | null;
  completed_at?: string | null;
  members?: { id: string; role?: string; type?: string; name?: string }[];
  url?: string;
}

const tokenCache = new Map<string, { token: string; until: number }>();

/** Thin client for the Lark Open Platform endpoints this feature uses (tenant token, Task v2, IM v1). */
export class LarkApi {
  constructor(
    private base: string,
    private appId: string,
    private appSecret: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async token(): Promise<string> {
    const key = `${this.base}|${this.appId}`;
    const hit = tokenCache.get(key);
    if (hit && hit.until > Date.now() + 60_000) return hit.token;
    const res = await this.fetchImpl(`${this.base}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (!res.ok || body.code !== 0 || !body.tenant_access_token) throw new LarkError(body.code ?? res.status, `Lark từ chối App ID / App Secret: ${body.msg ?? res.statusText}`, res.status);
    tokenCache.set(key, { token: body.tenant_access_token, until: Date.now() + (body.expire ?? 3600) * 1000 });
    return body.tenant_access_token;
  }

  async call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    const token = await this.token();
    const res = await this.fetchImpl(`${this.base}/open-apis${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: T };
    if (!res.ok || out.code !== 0) throw new LarkError(out.code ?? res.status, `Lark ${method} ${path.split('?')[0]}: ${out.msg ?? res.statusText}`, res.status);
    return out.data as T;
  }

  createTask(body: Record<string, unknown>) {
    return this.call<{ task: LarkTaskData }>('POST', '/task/v2/tasks?user_id_type=open_id', body).then((d) => d.task);
  }
  createSubtask(parentGuid: string, body: Record<string, unknown>) {
    return this.call<{ subtask: LarkTaskData }>('POST', `/task/v2/tasks/${encodeURIComponent(parentGuid)}/subtasks?user_id_type=open_id`, body).then((d) => d.subtask);
  }
  getTask(guid: string) {
    return this.call<{ task: LarkTaskData }>('GET', `/task/v2/tasks/${encodeURIComponent(guid)}?user_id_type=open_id`).then((d) => d.task);
  }
  sendCard(chatId: string, card: unknown, uuid: string) {
    return this.call<{ message_id: string }>('POST', '/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
      uuid,
    });
  }
  replyCard(messageId: string, card: unknown) {
    return this.call<{ message_id: string }>('POST', `/im/v1/messages/${encodeURIComponent(messageId)}/reply`, { msg_type: 'interactive', content: JSON.stringify(card) });
  }
  // ---- 1.6 (PRD 10.3, U: permissions to confirm on a real Lark app) ----
  /** Direct message to one person (receive_id_type open_id). */
  sendCardToUser(openId: string, card: unknown, uuid: string) {
    return this.call<{ message_id: string }>('POST', '/im/v1/messages?receive_id_type=open_id', {
      receive_id: openId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
      uuid,
    });
  }
  /** Groups the bot is a member of. */
  async listChats(): Promise<{ chat_id: string; name: string }[]> {
    const out: { chat_id: string; name: string }[] = [];
    let token = '';
    for (let i = 0; i < 20; i++) {
      const d = await this.call<{ items?: { chat_id: string; name?: string }[]; has_more?: boolean; page_token?: string }>('GET', `/im/v1/chats?page_size=100${token ? `&page_token=${encodeURIComponent(token)}` : ''}`);
      for (const c of d.items ?? []) out.push({ chat_id: c.chat_id, name: c.name ?? '' });
      if (!d.has_more || !d.page_token) break;
      token = d.page_token;
    }
    return out;
  }
  async chatMembers(chatId: string): Promise<{ openId: string; name: string }[]> {
    const out: { openId: string; name: string }[] = [];
    let token = '';
    for (let i = 0; i < 20; i++) {
      const d = await this.call<{ items?: { member_id: string; name?: string }[]; has_more?: boolean; page_token?: string }>(
        'GET',
        `/im/v1/chats/${encodeURIComponent(chatId)}/members?member_id_type=open_id&page_size=100${token ? `&page_token=${encodeURIComponent(token)}` : ''}`,
      );
      for (const m of d.items ?? []) out.push({ openId: m.member_id, name: m.name ?? '' });
      if (!d.has_more || !d.page_token) break;
      token = d.page_token;
    }
    return out;
  }
  /** Changes fields of a task the bot created (Completed state, deadline, title). */
  patchTask(guid: string, task: Record<string, unknown>, fields: string[]) {
    return this.call<{ task: LarkTaskData }>('PATCH', `/task/v2/tasks/${encodeURIComponent(guid)}?user_id_type=open_id`, { task, update_fields: fields }).then((d) => d.task);
  }
}

export function apiOf(ctx: Ctx, cfg: LarkConfig): LarkApi {
  if (!cfg.appId || !cfg.appSecret) throw new ApiError(400, 'lark_config', 'Chưa có App ID / App Secret của Lark (Admin → S1 · Nhắc task Lark → Cấu hình).');
  return new LarkApi(cfg.apiBase, cfg.appId, cfg.appSecret, ctx.fetchImpl ?? fetch);
}

/** All-day due dates go to Lark as 00:00 UTC of that day; timed dues are read in the company time zone. */
export const dueToLark = (dueDate: string) => ({ timestamp: String(Date.parse(`${dueDate}T00:00:00Z`)), is_all_day: true });
export function dueFromLark(due: LarkTaskData['due'], timeZone: string): string | null {
  const ms = Number(due?.timestamp ?? 0);
  if (!ms) return null;
  return due?.is_all_day ? new Date(ms).toISOString().slice(0, 10) : localDateKey(ms, timeZone);
}

// ---------------------------------------------------------------------------------- rows --------

interface TaskRow {
  id: string;
  kind: 'parent' | 'child';
  parent_id: string | null;
  code: string;
  parent_code: string | null;
  name: string;
  description: string | null;
  assignee_open_id: string | null;
  assignee_name: string | null;
  due_date: string;
  mode: 'simulation' | 'live';
  lark_guid: string | null;
  lark_url: string | null;
  lark_title: string | null;
  completed_at: string | null;
  closed_at: string | null;
}
const TASK_COLS = 'id, kind, parent_id, code, parent_code, name, description, assignee_open_id, assignee_name, due_date, mode, lark_guid, lark_url, lark_title, completed_at, closed_at';

async function draftContext(ctx: Ctx, cfg: LarkConfig) {
  const rows = must(await ctx.db.from('lark_tasks').select('code, kind, due_date, name, id').is('deleted_at', null), 'load lark codes') as {
    code: string;
    kind: string;
    due_date: string;
    name: string;
    id: string;
  }[];
  return {
    rows,
    ctx: {
      rules: cfg.rules,
      now: ctx.now(),
      timeZone: cfg.timeZone,
      existingCodes: new Set(rows.map((r) => normalizeCode(r.code))),
      parents: new Map(rows.filter((r) => r.kind === 'parent').map((r) => [normalizeCode(r.code), { dueDate: r.due_date }])),
    },
  };
}

export async function rememberPeople(ctx: Ctx, people: { openId: string; name: string }[]) {
  const rows = people.filter((p) => p.openId && p.name).map((p) => ({ open_id: p.openId, name: p.name, updated_at: new Date().toISOString() }));
  if (rows.length) await ctx.db.from('lark_people').upsert(rows, { onConflict: 'open_id' });
}

/** In simulation, every active Ops Hub user can be tagged as "sim:<profile id>". */
export async function ensureSimPeople(ctx: Ctx) {
  const profiles = must(await ctx.db.from('profiles').select('id, full_name, email').eq('active', true), 'load profiles') as { id: string; full_name: string; email: string }[];
  const rows = profiles.map((p) => ({ open_id: `sim:${p.id}`, name: p.full_name || p.email, profile_id: p.id, updated_at: new Date().toISOString() }));
  if (rows.length) must(await ctx.db.from('lark_people').upsert(rows, { onConflict: 'open_id' }), 'save people');
  return { people: rows.length };
}

// ------------------------------------------------------------------------------ creating --------

interface CreateResult {
  ok: boolean;
  errors: string[];
  task?: TaskRow;
}

/** Re-checks a draft against today's data and creates it (on Lark when live). Brief 2.4 → step 3. */
async function createFromDraft(ctx: Ctx, cfg: LarkConfig, d: LarkDraft, by: { openId?: string | null; profileId?: string | null; source: 'bot' | 'web' }): Promise<CreateResult> {
  const { ctx: dctx } = await draftContext(ctx, cfg);
  const code = normalizeCode(d.code);
  const draft: LarkDraft = { ...d, code, parentCode: d.kind === 'child' ? normalizeCode(d.parentCode || parentCodeOf(code, cfg.rules) || '') : null };
  const errors = validateDraft(draft, dctx);
  if (errors.length) return { ok: false, errors };

  let parent: TaskRow | null = null;
  if (draft.kind === 'child') {
    parent = must(
      await ctx.db.from('lark_tasks').select(TASK_COLS).eq('kind', 'parent').ilike('code', draft.parentCode!).is('deleted_at', null).maybeSingle(),
      'load parent',
    ) as TaskRow | null;
    if (!parent) return { ok: false, errors: [`Chưa có task mẹ ${draft.parentCode}.`] };
  }
  const mode = cfg.mode;
  let guid: string | null = null;
  let url: string | null = null;
  const title = larkTitle(draft.kind, code, draft.name);
  if (mode === 'live') {
    const api = apiOf(ctx, cfg);
    const body = {
      summary: title,
      description: draft.description ?? '',
      due: dueToLark(draft.dueDate!),
      members: draft.assigneeOpenId ? [{ id: draft.assigneeOpenId, type: 'user', role: 'assignee' }] : [],
      client_token: crypto.randomUUID(),
    };
    try {
      if (draft.kind === 'parent') {
        const t = await api.createTask(body);
        guid = t.guid;
        url = t.url ?? null;
      } else {
        if (!parent!.lark_guid) return { ok: false, errors: [`Task mẹ ${parent!.code} được tạo ở chế độ mô phỏng, không có trên Lark.`] };
        const t = await api.createSubtask(parent!.lark_guid, body);
        guid = t.guid;
        url = t.url ?? null;
      }
    } catch (e) {
      return { ok: false, errors: [`Lark chưa tạo được task: ${(e as Error).message}`] };
    }
  }
  const row = must(
    await ctx.db
      .from('lark_tasks')
      .insert({
        kind: draft.kind,
        parent_id: parent?.id ?? null,
        code,
        parent_code: parent?.code ?? null,
        name: draft.name.trim(),
        description: draft.description ?? null,
        assignee_open_id: draft.assigneeOpenId,
        assignee_name: draft.assigneeName,
        due_date: draft.dueDate,
        mode,
        lark_guid: guid,
        lark_url: url,
        lark_title: title,
        source: by.source,
        created_by_open_id: by.openId ?? null,
        created_by: by.profileId ?? null,
        synced_at: mode === 'live' ? new Date(ctx.now()).toISOString() : null,
      })
      .select(TASK_COLS)
      .single(),
    'save lark task',
  ) as TaskRow;
  return { ok: true, errors: [], task: row };
}

function createdMessage(t: TaskRow): BotMessage {
  const lines: BotMessage['lines'] = [
    { icon: t.kind === 'parent' ? '📌' : '🔸', label: t.kind === 'parent' ? 'Task mẹ' : 'Task con', text: larkTitle(t.kind, t.code, t.name) },
    { icon: '👤', label: t.kind === 'parent' ? 'Người phụ trách' : 'Người thực hiện', text: t.assignee_name ?? '', mentionOpenId: t.assignee_open_id },
    { icon: '⏰', label: 'Deadline', text: fmtDueDate(t.due_date) },
  ];
  if (t.lark_url) lines.push({ icon: '🔗', text: `[Mở trên Lark Tasks](${t.lark_url})` });
  return {
    tone: 'green',
    title: t.kind === 'parent' ? '✅ Đã tạo task mẹ' : '✅ Đã tạo task con',
    lines,
    note: t.kind === 'parent' ? `Tạo task con: /taomoi con ${t.code}-01-S01 | … | @người | deadline` : 'Bot sẽ nhắc trong group từ D-3 đến khi task Completed.',
  };
}

/** Web form (and simulation): same checks and creation as the bot. */
export async function createLarkTaskFromWeb(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const cfg = await loadLarkConfig(ctx);
  const openId = String(body.assignee_open_id ?? '') || null;
  let name: string | null = null;
  if (openId) {
    const p = must(await ctx.db.from('lark_people').select('name').eq('open_id', openId).maybeSingle(), 'load person') as { name: string } | null;
    name = p?.name ?? null;
  }
  const draft: LarkDraft = {
    kind: body.kind === 'child' ? 'child' : 'parent',
    code: String(body.code ?? ''),
    name: String(body.name ?? ''),
    assigneeOpenId: openId,
    assigneeName: name,
    dueDate: body.due_date ? String(body.due_date) : null,
    description: body.description ? String(body.description) : null,
    parentCode: body.parent_code ? String(body.parent_code) : null,
  };
  if (body.dry_run) {
    const { ctx: dctx } = await draftContext(ctx, cfg);
    const d = { ...draft, code: normalizeCode(draft.code), parentCode: draft.kind === 'child' ? normalizeCode(draft.parentCode || parentCodeOf(normalizeCode(draft.code), cfg.rules) || '') : null };
    return { ok: true, errors: validateDraft(d, dctx), mode: cfg.mode };
  }
  const res = await createFromDraft(ctx, cfg, draft, { profileId: user.id, source: 'web' });
  if (!res.ok) throw new ApiError(400, 'invalid', res.errors.join(' '));
  return { ok: true, task: res.task, mode: cfg.mode };
}

// ------------------------------------------------------------------------------- bot side --------

interface LarkEventBody {
  type?: string;
  challenge?: string;
  token?: string;
  encrypt?: string;
  schema?: string;
  header?: { event_id?: string; event_type?: string; token?: string };
  event?: Record<string, unknown>;
  // legacy card callback
  open_id?: string;
  action?: { value?: Record<string, string> };
}

const LEADING_MENTIONS = /^(\s*@_user_\d+\s*)+/;

async function onMessage(ctx: Ctx, cfg: LarkConfig, ev: Record<string, unknown>, api: LarkApi) {
  const message = (ev.message ?? {}) as { message_id: string; chat_id?: string; message_type?: string; content?: string; chat_type?: string; mentions?: { key: string; id?: { open_id?: string }; name?: string }[] };
  const sender = ((ev.sender as { sender_id?: { open_id?: string } })?.sender_id?.open_id ?? '') as string;
  const reply = (m: BotMessage) => api.replyCard(message.message_id, toLarkCard(m)).catch((e) => console.error('lark reply failed', e));
  if (message.message_type !== 'text') return reply({ tone: 'blue', title: 'Hướng dẫn', lines: [{ icon: 'ℹ️', text: PROJECT_HELP_TEXT }] });
  const raw = String((JSON.parse(message.content ?? '{}') as { text?: string }).text ?? '');
  const mentions = (message.mentions ?? []).map((m) => ({ key: m.key, openId: m.id?.open_id ?? '', name: m.name ?? '' })).filter((m) => m.openId);
  await rememberPeople(ctx, mentions);
  const text = raw.replace(LEADING_MENTIONS, '').trim();
  const low = text.toLowerCase().normalize('NFC');

  if (/^(xác nhận|xac nhan|ok|đồng ý|dong y|yes)$/.test(low) || /^(huỷ|hủy|huy|cancel)$/.test(low)) {
    const pending = must(
      await ctx.db.from('lark_drafts').select('id, open_id, draft, status').eq('open_id', sender).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      'load draft',
    ) as DraftRow | null;
    if (!pending) return reply({ tone: 'grey', title: 'Không có bản nháp nào đang chờ', lines: [{ icon: 'ℹ️', text: 'Gửi lệnh /taomoi để tạo task.' }] });
    return reply(await settleDraft(ctx, cfg, pending, sender, /^(huỷ|hủy|huy|cancel)$/.test(low) ? 'cancel' : 'confirm'));
  }
  // 1.6: "/taomoi duan|task" (and the 1.5 forms "me|con"), PM only, codes generated by the bot.
  await handleWorkCommand(ctx, { sender, chatId: message.chat_id ?? null, text, mentions, reply });
}

interface DraftRow {
  id: string;
  open_id: string;
  draft: LarkDraft;
  status: string;
}

async function settleDraft(ctx: Ctx, cfg: LarkConfig, row: DraftRow, operator: string, op: 'confirm' | 'cancel'): Promise<BotMessage> {
  if (row.status !== 'pending') return { tone: 'grey', title: 'Bản nháp này đã được xử lý', lines: [{ icon: 'ℹ️', text: 'Gửi lệnh /taomoi mới nếu cần.' }] };
  if (row.open_id !== operator) return { tone: 'red', title: 'Chỉ người gửi lệnh mới xác nhận được', lines: [] };
  if (op === 'cancel') {
    await ctx.db.from('lark_drafts').update({ status: 'cancelled' }).eq('id', row.id).eq('status', 'pending');
    return { tone: 'grey', title: 'Đã huỷ, không tạo task', lines: [{ icon: '🗑️', text: normalizeCode(row.draft.code) }] };
  }
  // Claim the draft first so a double click creates one task only.
  const claimed = must(await ctx.db.from('lark_drafts').update({ status: 'confirmed' }).eq('id', row.id).eq('status', 'pending').select('id'), 'claim draft') as unknown[];
  if (!claimed.length) return { tone: 'grey', title: 'Bản nháp này đã được xử lý', lines: [] };
  if (isWorkDraft(row.draft)) {
    const msg = await settleWorkDraft(ctx, row.draft);
    if (msg.tone === 'red') await ctx.db.from('lark_drafts').update({ status: 'cancelled' }).eq('id', row.id);
    return msg;
  }
  const res = await createFromDraft(ctx, cfg, row.draft, { openId: operator, source: 'bot' });
  if (!res.ok) {
    await ctx.db.from('lark_drafts').update({ status: 'cancelled' }).eq('id', row.id);
    return errorMessage('Chưa tạo được task', res.errors);
  }
  await ctx.db.from('lark_drafts').update({ task_id: res.task!.id }).eq('id', row.id);
  return createdMessage(res.task!);
}

/**
 * POST /ops-hub/lark-events — Lark event subscription and card callbacks (Encrypt Key must stay empty).
 * Checks the Verification Token, answers the URL challenge, ignores re-delivered events.
 */
export async function handleLarkEvent(ctx: Ctx, req: Request): Promise<unknown> {
  const body = (await req.json().catch(() => ({}))) as LarkEventBody;
  const cfg = await loadLarkConfig(ctx);
  if (body.encrypt) throw new ApiError(400, 'encrypted', 'Hãy để trống Encrypt Key trong Lark Developer Console (Events & Callbacks).');
  const token = body.header?.token ?? body.token;
  if (!cfg.verificationToken || !safeEqual(token, cfg.verificationToken)) throw new ApiError(401, 'unauthorized', 'Wrong Lark verification token');
  if (body.type === 'url_verification') return { challenge: body.challenge };
  if (cfg.mode !== 'live') return { ok: true, ignored: 'simulation mode' };

  const eventId = body.header?.event_id;
  if (eventId) {
    const { error } = await ctx.db.from('lark_events').insert({ event_id: eventId, event_type: body.header?.event_type ?? null });
    if (error) return { ok: true, duplicate: true };
  }
  const api = apiOf(ctx, cfg);
  const type = body.header?.event_type;
  if (type === 'im.message.receive_v1') {
    await onMessage(ctx, cfg, body.event ?? {}, api);
    return { ok: true };
  }
  // Card button: new callback (card.action.trigger) or the legacy card request URL.
  const isNew = type === 'card.action.trigger';
  const operator = isNew ? String(((body.event?.operator ?? {}) as { open_id?: string }).open_id ?? '') : String(body.open_id ?? '');
  const value = isNew ? ((body.event?.action ?? {}) as { value?: Record<string, string> }).value : body.action?.value;
  if (value?.op === 'progress' && value.task) {
    const msg = await progressFromCard(ctx, operator, value);
    const card = toLarkCard(msg);
    return isNew ? { toast: { type: msg.tone === 'red' ? 'error' : 'success', content: msg.title }, card: { type: 'raw', data: card } } : card;
  }
  if (value?.draft) {
    const row = must(await ctx.db.from('lark_drafts').select('id, open_id, draft, status').eq('id', value.draft).maybeSingle(), 'load draft') as DraftRow | null;
    const msg = row ? await settleDraft(ctx, cfg, row, operator, value.op === 'cancel' ? 'cancel' : 'confirm') : { tone: 'grey' as const, title: 'Không tìm thấy bản nháp', lines: [] };
    const card = toLarkCard(msg);
    return isNew ? { toast: { type: msg.tone === 'red' ? 'error' : 'success', content: msg.title }, card: { type: 'raw', data: card } } : card;
  }
  return { ok: true };
}

// ------------------------------------------------------------------------- sync and remind --------

function localHM(now: number, timeZone: string): string {
  const p = toLocalParts(now, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Pulls deadline, assignee and Completed state from Lark (1.6, PRD 10.2). The task is identified by its
 * Lark guid: the code and name stay as Ops Hub set them, whatever the title says on Lark. A task deadline
 * moved on Lark past the project deadline is put back; a project deadline is only changed in Ops Hub.
 */
async function syncFromLark(ctx: Ctx, cfg: LarkConfig, api: LarkApi, t: TaskRow): Promise<TaskRow> {
  const lt = await api.getTask(t.lark_guid!);
  const title = lt.summary ?? t.lark_title ?? '';
  const assignee = (lt.members ?? []).find((m) => m.role === 'assignee');
  let due = dueFromLark(lt.due, cfg.timeZone) ?? t.due_date;
  const completedMs = Number(lt.completed_at ?? 0);
  let assigneeName = t.assignee_name;
  let assigneeId: string | null | undefined;
  if (assignee && assignee.id !== t.assignee_open_id) {
    const p = must(await ctx.db.from('lark_people').select('name, profile_id').eq('open_id', assignee.id).maybeSingle(), 'load person') as { name: string; profile_id: string | null } | null;
    assigneeName = assignee.name ?? p?.name ?? null;
    assigneeId = p?.profile_id ?? null;
  }
  if (t.kind === 'parent') due = t.due_date;
  else if (due !== t.due_date && t.parent_id) {
    const parent = must(await ctx.db.from('lark_tasks').select('due_date').eq('id', t.parent_id).maybeSingle(), 'load project') as { due_date: string } | null;
    if (parent && due > parent.due_date) {
      try {
        await api.patchTask(t.lark_guid!, { due: dueToLark(t.due_date) }, ['due']);
      } catch (e) {
        console.error('lark due revert failed', (e as Error).message);
      }
      due = t.due_date;
    }
  }
  const patch: Record<string, unknown> = {
    lark_title: title,
    due_date: due,
    assignee_open_id: assignee?.id ?? t.assignee_open_id,
    assignee_name: assigneeName,
    completed_at: completedMs ? new Date(completedMs).toISOString() : null,
    lark_url: lt.url ?? t.lark_url,
    synced_at: new Date(ctx.now()).toISOString(),
  };
  if (assigneeId !== undefined) patch.assignee_id = assigneeId;
  if (assigneeId && t.kind === 'child' && t.parent_id) {
    await ctx.db.from('project_members').insert({ project_id: t.parent_id, profile_id: assigneeId, open_id: assignee!.id, name: assigneeName ?? '', source: 'task' });
  }
  return must(await ctx.db.from('lark_tasks').update(patch).eq('id', t.id).select(TASK_COLS).single(), 'save sync') as TaskRow;
}


export interface LarkTickResult {
  mode: string;
  today: string;
  synced: number;
  syncErrors: number;
  reminders: number;
  completions: number;
  failed: number;
  waitingForTime: number;
  checkins?: number;
  nudges?: number;
  summaries?: number;
  fromLark?: number;
  note?: string;
}

/**
 * Runs every 15 minutes from pg_cron (and from Admin → "Chạy nhắc việc ngay"). Syncs open tasks from Lark,
 * then runs the 1.6 jobs (work.ts): reminders by task length, progress questions, review nudges and the
 * PM summaries. Restart-safe: every message has a unique key in bot_messages.
 */
export async function larkTick(ctx: Ctx, opts: { force?: boolean } = {}): Promise<LarkTickResult> {
  const cfg = await loadLarkConfig(ctx);
  const now = ctx.now();
  const today = localDateKey(now, cfg.timeZone);
  const res: LarkTickResult = { mode: cfg.mode, today, synced: 0, syncErrors: 0, reminders: 0, completions: 0, failed: 0, waitingForTime: 0 };
  let api: LarkApi | null = null;
  if (cfg.mode === 'live') {
    if (!cfg.appId || !cfg.appSecret) {
      res.note = 'Chế độ thật nhưng thiếu App ID / App Secret: không gửi.';
      await saveStatus(ctx, res);
      return res;
    }
    api = new LarkApi(cfg.apiBase, cfg.appId, cfg.appSecret, ctx.fetchImpl ?? fetch);
    const tasks = must(await ctx.db.from('lark_tasks').select(TASK_COLS).is('closed_at', null).is('deleted_at', null).eq('mode', 'live'), 'load open lark tasks') as TaskRow[];
    for (const t of tasks) {
      if (!t.lark_guid) continue;
      try {
        await syncFromLark(ctx, cfg, api, t);
        res.synced++;
      } catch (e) {
        res.syncErrors++;
        console.error('lark sync failed', t.code, (e as Error).message);
      }
    }
  }
  const work = await workTick(ctx, api, opts);
  res.reminders = work.reminders;
  res.completions = work.closed;
  res.checkins = work.checkins;
  res.nudges = work.nudges;
  res.summaries = work.summaries;
  res.fromLark = work.fromLark;
  if (!opts.force && localHM(now, cfg.timeZone) < cfg.notifyTime) res.waitingForTime = 1;
  const failed = await ctx.db.from('bot_messages').select('id', { count: 'exact', head: true }).eq('local_date', today).eq('status', 'failed');
  res.failed = failed.count ?? 0;
  await saveStatus(ctx, res);
  return res;
}

async function saveStatus(ctx: Ctx, res: LarkTickResult) {
  await ctx.db.from('settings').update({ lark_status: { ...res, at: new Date(ctx.now()).toISOString() } }).eq('id', 1);
}

// ----------------------------------------------------------------------- web-only actions --------


/**
 * Simulation controls (what staff would do on Lark Tasks): complete / reopen a sub-task, move the
 * deadline, change the assignee, or edit the code in the title to test the code check.
 */
export async function simulateLark(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const t = must(await ctx.db.from('lark_tasks').select(TASK_COLS).eq('id', String(body.task_id ?? '')).maybeSingle(), 'load task') as TaskRow | null;
  if (!t) throw new ApiError(404, 'not_found', 'Không tìm thấy task.');
  if (t.mode !== 'simulation') throw new ApiError(400, 'live', 'Task này nằm trên Lark thật: hãy sửa trên Lark Tasks, hệ thống tự đồng bộ.');
  // 1.6: a test tool that plays what someone does on Lark Tasks; nobody completes work for someone else in the app.
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ admin dùng công cụ mô phỏng Lark.');
  const patch: Record<string, unknown> = {};
  switch (body.op) {
    case 'complete':
      patch.completed_at = new Date(ctx.now()).toISOString();
      break;
    case 'reopen':
      patch.completed_at = null;
      patch.closed_at = null;
      break;
    case 'set_due':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date ?? ''))) throw new ApiError(400, 'invalid', 'Ngày không hợp lệ.');
      patch.due_date = body.due_date;
      break;
    case 'set_assignee': {
      const p = must(await ctx.db.from('lark_people').select('open_id, name').eq('open_id', String(body.open_id ?? '')).maybeSingle(), 'load person') as { open_id: string; name: string } | null;
      if (!p) throw new ApiError(400, 'invalid', 'Không tìm thấy người này.');
      patch.assignee_open_id = p.open_id;
      patch.assignee_name = p.name;
      break;
    }
    case 'set_code':
      patch.code = normalizeCode(String(body.code ?? ''));
      patch.lark_title = larkTitle(t.kind, String(patch.code), t.name);
      break;
    default:
      throw new ApiError(400, 'unknown_op', 'Thao tác không hợp lệ.');
  }
  must(await ctx.db.from('lark_tasks').update(patch).eq('id', t.id), 'save simulation');
  return { ok: true };
}

export async function larkAdminStatus(ctx: Ctx, user: Profile) {
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ admin.');
  const cfg = await loadLarkConfig(ctx);
  return {
    mode: cfg.mode,
    hasAppSecret: !!cfg.appSecret,
    hasVerificationToken: !!cfg.verificationToken,
    eventsUrl: `${ctx.env.functionsBase}/ops-hub/lark-events`,
    rulesErrors: validateCodeRules(cfg.rules),
  };
}

/** Admin saves the Lark settings; the App Secret and Verification Token go to Vault, never to a table. */
export async function saveLarkConfig(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ admin.');
  const str = (k: string) => (body[k] === undefined ? undefined : String(body[k]).trim());
  const patch: Record<string, unknown> = {};
  for (const k of ['lark_api_base', 'lark_app_id', 'lark_chat_id', 'lark_parent_pattern', 'lark_child_pattern', 'lark_parent_example', 'lark_child_example', 'lark_notify_time']) {
    const v = str(k);
    if (v !== undefined) patch[k] = v;
  }
  if (body.lark_mode !== undefined) patch.lark_mode = body.lark_mode === 'live' ? 'live' : 'simulation';
  if (body.lark_notify_d0 !== undefined) patch.lark_notify_d0 = !!body.lark_notify_d0;
  for (const k of ['summary_morning_time', 'summary_evening_time']) {
    const v = str(k);
    if (v === undefined) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new ApiError(400, 'invalid', 'Giờ gửi tóm tắt phải dạng HH:MM.');
    patch[k] = v;
  }
  if (body.summary_evening_on !== undefined) patch.summary_evening_on = !!body.summary_evening_on;
  if (patch.lark_notify_time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.lark_notify_time))) throw new ApiError(400, 'invalid', 'Giờ gửi phải dạng HH:MM.');
  const cfg = await loadLarkConfig(ctx);
  const rules = {
    parentPattern: String(patch.lark_parent_pattern ?? cfg.rules.parentPattern),
    childPattern: String(patch.lark_child_pattern ?? cfg.rules.childPattern),
    parentExample: String(patch.lark_parent_example ?? cfg.rules.parentExample),
    childExample: String(patch.lark_child_example ?? cfg.rules.childExample),
  };
  const errs = validateCodeRules(rules);
  if (errs.length) throw new ApiError(400, 'invalid', errs.join(' '));
  if (Object.keys(patch).length) must(await ctx.db.from('settings').update(patch).eq('id', 1), 'save lark settings');
  for (const [k, name] of [
    ['app_secret', 'lark_app_secret'],
    ['verification_token', 'lark_verification_token'],
  ] as const) {
    const v = str(k);
    if (v) must(await ctx.db.rpc('ops_set_lark_secret', { p_name: name, p_value: v }), 'save lark secret');
  }
  return larkAdminStatus(ctx, user);
}

/** Admin: check App ID / Secret and the group by posting a test card. */
export async function testLark(ctx: Ctx, user: Profile) {
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ admin.');
  const cfg = await loadLarkConfig(ctx);
  if (cfg.mode !== 'live') return { ok: true, note: 'Đang ở chế độ mô phỏng: không gọi Lark.' };
  const api = apiOf(ctx, cfg);
  await api.token();
  if (!cfg.chatId) return { ok: true, note: 'App ID / Secret đúng. Chưa có chat_id của group nên chưa gửi thử.' };
  await api.sendCard(cfg.chatId, toLarkCard({ tone: 'blue', title: 'Go Media Ops Hub đã kết nối', lines: [{ icon: '✅', text: 'Bot sẽ nhắc task trong group này lúc ' + cfg.notifyTime + ' mỗi ngày.' }] }), crypto.randomUUID().slice(0, 32));
  return { ok: true, note: 'Đã gửi tin thử vào group.' };
}

/** Admin links a Lark account (learnt from group members and @mentions) to an Ops Hub user. */
export async function linkLarkPerson(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ admin.');
  const openId = String(body.open_id ?? '');
  if (!openId || openId.startsWith('sim:')) throw new ApiError(400, 'invalid', 'Chọn một tài khoản Lark.');
  const profileId = body.profile_id ? String(body.profile_id) : null;
  if (profileId) await ctx.db.from('lark_people').update({ profile_id: null }).eq('profile_id', profileId).not('open_id', 'like', 'sim:%').neq('open_id', openId);
  must(await ctx.db.from('lark_people').update({ profile_id: profileId, updated_at: new Date(ctx.now()).toISOString() }).eq('open_id', openId), 'link person');
  if (profileId) {
    await ctx.db.from('lark_tasks').update({ assignee_id: profileId }).eq('assignee_open_id', openId).is('assignee_id', null);
    await ctx.db.from('project_members').update({ profile_id: profileId }).eq('open_id', openId).is('profile_id', null);
  }
  return { ok: true };
}

/** Admin → Kết nối Lark → "Chạy nhắc việc ngay (kiểm thử)" (PRD 4.3). */
export async function runLarkNow(ctx: Ctx, user: Profile) {
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ admin.');
  return larkTick(ctx, { force: true });
}
