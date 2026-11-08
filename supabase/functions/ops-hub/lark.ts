// S1 on Lark (brief A2.3). The bot takes "/taomoi" commands, checks the codes, shows a preview and creates
// the parent task / sub-task on Lark Tasks after "Xác nhận tạo". Every 15 minutes (pg_cron) the backend
// syncs open tasks from Lark; from 09:00 it sends at most one reminder per sub-task per day into the
// group, tagging the assignee, and confirms completion once the sub-task is Completed with valid codes.
// In simulation mode (no Lark app yet) the same flow runs without calling Lark: messages are stored and
// shown on the web page "S1 · Nhắc task Lark".
import {
  BotMessage,
  completionMessage,
  decideLarkAction,
  DEFAULT_LARK_SCHEDULE,
  draftPreviewMessage,
  errorMessage,
  findCodeInTitle,
  LARK_HELP_TEXT,
  LarkCodeRules,
  LarkDraft,
  larkTitle,
  localDateKey,
  normalizeCode,
  parentCodeOf,
  parseCreateCommand,
  reminderMessage,
  stripCodeFromTitle,
  toLarkCard,
  toLocalParts,
  pad2,
  validateCodeRules,
  validateDraft,
  checkChildCode,
  checkParentCode,
  fmtDueDate,
} from '../../../src/domain/index';
import { Ctx, loadSettings, Profile } from './context';
import { ApiError, must, safeEqual } from './http';

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
}

function apiOf(ctx: Ctx, cfg: LarkConfig): LarkApi {
  if (!cfg.appId || !cfg.appSecret) throw new ApiError(400, 'lark_config', 'Chưa có App ID / App Secret của Lark (Admin → S1 · Nhắc task Lark → Cấu hình).');
  return new LarkApi(cfg.apiBase, cfg.appId, cfg.appSecret, ctx.fetchImpl ?? fetch);
}

/** All-day due dates go to Lark as 00:00 UTC of that day; timed dues are read in the company time zone. */
const dueToLark = (dueDate: string) => ({ timestamp: String(Date.parse(`${dueDate}T00:00:00Z`)), is_all_day: true });
function dueFromLark(due: LarkTaskData['due'], timeZone: string): string | null {
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

async function rememberPeople(ctx: Ctx, people: { openId: string; name: string }[]) {
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
  const message = (ev.message ?? {}) as { message_id: string; message_type?: string; content?: string; chat_type?: string; mentions?: { key: string; id?: { open_id?: string }; name?: string }[] };
  const sender = ((ev.sender as { sender_id?: { open_id?: string } })?.sender_id?.open_id ?? '') as string;
  const reply = (m: BotMessage) => api.replyCard(message.message_id, toLarkCard(m)).catch((e) => console.error('lark reply failed', e));
  if (message.message_type !== 'text') return reply({ tone: 'blue', title: 'Hướng dẫn tạo task', lines: [{ icon: 'ℹ️', text: LARK_HELP_TEXT }] });
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
  const parsed = parseCreateCommand(text, mentions, ctx.now(), cfg.timeZone);
  if (parsed.help || !parsed.draft) return reply({ tone: 'blue', title: 'Hướng dẫn tạo task', lines: [{ icon: 'ℹ️', text: LARK_HELP_TEXT }] });
  const d = parsed.draft;
  if (d.kind === 'child') d.parentCode = parentCodeOf(d.code, cfg.rules);
  const { ctx: dctx, rows } = await draftContext(ctx, cfg);
  const errors = [...parsed.errors, ...validateDraft(d, dctx)];
  if (errors.length) return reply(errorMessage(d.kind === 'parent' ? 'Chưa tạo task mẹ' : 'Chưa tạo task con', errors));
  const saved = must(await ctx.db.from('lark_drafts').insert({ open_id: sender, draft: d }).select('id').single(), 'save draft') as { id: string };
  const parentName = d.kind === 'child' ? rows.find((r) => r.kind === 'parent' && normalizeCode(r.code) === normalizeCode(d.parentCode ?? ''))?.name : null;
  return reply(draftPreviewMessage(d, saved.id, parentName));
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

/** Pulls title, deadline, assignee and Completed state from Lark. A broken code in the title is kept as is. */
async function syncFromLark(ctx: Ctx, cfg: LarkConfig, api: LarkApi, t: TaskRow): Promise<TaskRow> {
  const lt = await api.getTask(t.lark_guid!);
  const title = lt.summary ?? t.lark_title ?? '';
  const found = findCodeInTitle(title, t.kind, cfg.rules);
  const assignee = (lt.members ?? []).find((m) => m.role === 'assignee');
  const due = dueFromLark(lt.due, cfg.timeZone) ?? t.due_date;
  const completedMs = Number(lt.completed_at ?? 0);
  let assigneeName = t.assignee_name;
  if (assignee && assignee.id !== t.assignee_open_id) {
    const p = must(await ctx.db.from('lark_people').select('name').eq('open_id', assignee.id).maybeSingle(), 'load person') as { name: string } | null;
    assigneeName = assignee.name ?? p?.name ?? null;
  }
  // Codes are read from the current title: if someone edits it on Lark and breaks the code, completion is refused.
  const code = found ?? (title.match(/\(([^()]+)\)\s*$/)?.[1] ?? title.match(/^\s*\[([^\]]+)\]/)?.[1] ?? t.code);
  const patch = {
    lark_title: title,
    name: stripCodeFromTitle(title, code) || t.name,
    code: normalizeCode(code),
    due_date: due,
    assignee_open_id: assignee?.id ?? t.assignee_open_id,
    assignee_name: assigneeName,
    completed_at: completedMs ? new Date(completedMs).toISOString() : null,
    lark_url: lt.url ?? t.lark_url,
    synced_at: new Date(ctx.now()).toISOString(),
  };
  return must(await ctx.db.from('lark_tasks').update(patch).eq('id', t.id).select(TASK_COLS).single(), 'save sync') as TaskRow;
}

interface NotifRow {
  id: string;
  task_id: string;
  kind: 'reminder' | 'completion';
  status: string;
  attempts: number;
}
const MAX_ATTEMPTS = 5;

/**
 * Claims today's slot for (task, kind) before sending, so two overlapping runs never both send.
 * Returns the row to fill in, or null when today's message is already out or has failed too often.
 */
async function claim(ctx: Ctx, taskId: string, today: string, kind: 'reminder' | 'completion', msg: BotMessage, milestone: string | null, assignee: string | null): Promise<NotifRow | null> {
  const base = { task_id: taskId, local_date: today, kind, milestone, assignee_open_id: assignee, message: msg };
  const ins = await ctx.db.from('lark_notifications').insert({ ...base, status: 'failed', attempts: 1, last_error: 'đang gửi' }).select('id, task_id, kind, status, attempts').maybeSingle();
  if (!ins.error && ins.data) return ins.data as NotifRow;
  const cur = must(await ctx.db.from('lark_notifications').select('id, task_id, kind, status, attempts').eq('task_id', taskId).eq('local_date', today).eq('kind', kind).maybeSingle(), 'load notification') as NotifRow | null;
  if (!cur || cur.status !== 'failed' || cur.attempts >= MAX_ATTEMPTS) return null;
  const upd = must(
    await ctx.db.from('lark_notifications').update({ attempts: cur.attempts + 1, message: msg, milestone, assignee_open_id: assignee }).eq('id', cur.id).eq('attempts', cur.attempts).select('id, task_id, kind, status, attempts'),
    'claim retry',
  ) as NotifRow[];
  return upd[0] ?? null;
}

async function deliver(ctx: Ctx, cfg: LarkConfig, api: LarkApi | null, slot: NotifRow, msg: BotMessage, today: string): Promise<boolean> {
  try {
    let messageId: string | null = null;
    if (cfg.mode === 'live') {
      if (!cfg.chatId) throw new Error('Chưa cấu hình group Lark nhận thông báo (chat_id).');
      const r = await api!.sendCard(cfg.chatId, toLarkCard(msg), `${slot.id.slice(0, 18)}-${today}-${slot.attempts}`);
      messageId = r.message_id;
    }
    must(
      await ctx.db
        .from('lark_notifications')
        .update({ status: cfg.mode === 'live' ? 'sent' : 'simulated', last_error: null, sent_at: new Date(ctx.now()).toISOString(), lark_message_id: messageId })
        .eq('id', slot.id),
      'save notification',
    );
    return true;
  } catch (e) {
    await ctx.db.from('lark_notifications').update({ status: 'failed', last_error: (e as Error).message.slice(0, 500) }).eq('id', slot.id);
    return false;
  }
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
  note?: string;
}

/**
 * Runs every 15 minutes from pg_cron and on "Chạy kiểm tra ngay". Completion is confirmed on any run;
 * reminders go out from the configured time (09:00) — `force` sends them now. Restart-safe: the state
 * lives in lark_tasks / lark_notifications.
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
  }
  let tasks = must(await ctx.db.from('lark_tasks').select(TASK_COLS).is('closed_at', null).is('deleted_at', null), 'load open lark tasks') as TaskRow[];
  if (api) {
    const synced: TaskRow[] = [];
    for (const t of tasks) {
      if (t.mode !== 'live' || !t.lark_guid) continue;
      try {
        synced.push(await syncFromLark(ctx, cfg, api, t));
        res.synced++;
      } catch (e) {
        res.syncErrors++;
        console.error('lark sync failed', t.code, (e as Error).message);
        synced.push(t);
      }
    }
    tasks = synced;
  } else tasks = tasks.filter((t) => t.mode === 'simulation');

  const parents = new Map(
    (must(await ctx.db.from('lark_tasks').select('id, code, name').eq('kind', 'parent'), 'load parents') as { id: string; code: string; name: string }[]).map((p) => [p.id, p]),
  );
  const todays = must(await ctx.db.from('lark_notifications').select('task_id, kind, status, attempts').eq('local_date', today), 'load today') as NotifRow[];
  const done = new Set(todays.filter((n) => n.status !== 'failed' || n.attempts >= MAX_ATTEMPTS).map((n) => `${n.task_id}|${n.kind}`));
  const inWindow = opts.force || localHM(now, cfg.timeZone) >= cfg.notifyTime;
  const schedule = { ...DEFAULT_LARK_SCHEDULE, notifyD0: cfg.notifyD0 };

  for (const t of tasks.filter((x) => x.kind === 'child')) {
    const p = t.parent_id ? parents.get(t.parent_id) : undefined;
    const tracked = {
      parentCode: p?.code ?? t.parent_code ?? '',
      parentName: p ? stripCodeFromTitle(p.name, p.code) : '',
      childCode: t.code,
      childName: t.name,
      assigneeOpenId: t.assignee_open_id,
      assigneeName: t.assignee_name,
      dueDate: t.due_date,
      completedAt: t.completed_at ? Date.parse(t.completed_at) : null,
      closedAt: t.closed_at ? Date.parse(t.closed_at) : null,
    };
    const action = decideLarkAction(tracked, now, cfg.timeZone, { rules: cfg.rules, schedule, sentToday: done.has(`${t.id}|reminder`) });
    const codeErrors = [...checkParentCode(tracked.parentCode, cfg.rules), ...checkChildCode(t.code, tracked.parentCode, cfg.rules)];
    await ctx.db.from('lark_tasks').update({ code_errors: codeErrors }).eq('id', t.id);
    if (action.type === 'complete') {
      if (done.has(`${t.id}|completion`)) continue;
      const msg = completionMessage(tracked, cfg.timeZone);
      const slot = await claim(ctx, t.id, today, 'completion', msg, 'DONE', t.assignee_open_id);
      if (!slot) continue;
      if (await deliver(ctx, cfg, api, slot, msg, today)) {
        res.completions++;
        await ctx.db.from('lark_tasks').update({ closed_at: new Date(now).toISOString() }).eq('id', t.id);
      } else res.failed++;
    } else if (action.type === 'remind') {
      if (!inWindow) {
        res.waitingForTime++;
        continue;
      }
      const msg = reminderMessage(tracked, action.milestone, action.codeErrors);
      const slot = await claim(ctx, t.id, today, 'reminder', msg, action.milestone.label, t.assignee_open_id);
      if (!slot) continue;
      if (await deliver(ctx, cfg, api, slot, msg, today)) res.reminders++;
      else res.failed++;
    }
  }
  await saveStatus(ctx, res);
  return res;
}

async function saveStatus(ctx: Ctx, res: LarkTickResult) {
  await ctx.db.from('settings').update({ lark_status: { ...res, at: new Date(ctx.now()).toISOString() } }).eq('id', 1);
}

// ----------------------------------------------------------------------- web-only actions --------

const MANAGERS = ['admin', 'ecom_exec', 'pm', 'ceo'];

/**
 * Simulation controls (what staff would do on Lark Tasks): complete / reopen a sub-task, move the
 * deadline, change the assignee, or edit the code in the title to test the code check.
 */
export async function simulateLark(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const t = must(await ctx.db.from('lark_tasks').select(TASK_COLS).eq('id', String(body.task_id ?? '')).maybeSingle(), 'load task') as TaskRow | null;
  if (!t) throw new ApiError(404, 'not_found', 'Không tìm thấy task.');
  if (t.mode !== 'simulation') throw new ApiError(400, 'live', 'Task này nằm trên Lark thật: hãy sửa trên Lark Tasks, hệ thống tự đồng bộ.');
  const own = t.assignee_open_id === `sim:${user.id}`;
  if (!own && !MANAGERS.includes(user.role)) throw new ApiError(403, 'forbidden', 'Chỉ người thực hiện hoặc quản lý mới làm được.');
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

export async function runLarkNow(ctx: Ctx, user: Profile) {
  if (!MANAGERS.includes(user.role)) throw new ApiError(403, 'forbidden', 'Chỉ quản lý hoặc admin.');
  return larkTick(ctx, { force: true });
}
