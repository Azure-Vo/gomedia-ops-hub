// 1.8 · (1) Tin bot báo giá vào nhóm Lark qua webhook Custom Bot (hoặc mô phỏng: chỉ lưu và hiện trên web).
//       (2) Chữ ký Account (ảnh chữ ký cá nhân ở trang Hồ sơ).
//       (3) Link công khai cho khách: xem báo giá, ký xác nhận hoặc đề nghị điều chỉnh (không cần đăng nhập).
import {
  localDateKey,
  QuoteBotInput,
  QuoteBotKind,
  quoteBotMessage,
  ROLE_LABEL,
  toWebhookCard,
  WEBHOOK_URL_RE,
  workingHoursBetween,
} from '../../../src/domain/index';
import { appLink, calendarOf, Ctx, loadSettings, Profile, requireRole } from './context';
import { ApiError, must, randomToken } from './http';

// ------------------------------------------------------------------------------ webhook --------

interface WebhookRow {
  url: string;
  secret: string | null;
  label: string;
  active: boolean;
  updated_at: string;
}

async function loadWebhook(ctx: Ctx): Promise<WebhookRow | null> {
  const { data } = await ctx.db.from('lark_webhook').select('url, secret, label, active, updated_at').eq('id', 1).maybeSingle();
  return (data as WebhookRow | null) ?? null;
}

/** Chữ ký bảo mật của Custom Bot: base64(HMAC-SHA256(key = timestamp + "\n" + secret, message = "")). */
export async function webhookSign(timestamp: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${timestamp}\n${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array(0)));
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}

async function postWebhook(ctx: Ctx, hook: WebhookRow, card: Record<string, unknown>): Promise<void> {
  const body: Record<string, unknown> = { msg_type: 'interactive', card };
  if (hook.secret) {
    const timestamp = String(Math.floor(ctx.now() / 1000));
    body.timestamp = timestamp;
    body.sign = await webhookSign(timestamp, hook.secret);
  }
  const res = await (ctx.fetchImpl ?? fetch)(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; StatusCode?: number; StatusMessage?: string };
  const code = out.code ?? out.StatusCode ?? (res.ok ? 0 : res.status);
  if (!res.ok || code !== 0) throw new Error(`Lark webhook từ chối (${code}): ${out.msg ?? out.StatusMessage ?? res.statusText}`);
}

const maskUrl = (u: string) => u.replace(/(hook\/)(.{4}).*(.{4})$/, '$1$2…$3');

export async function webhookStatus(ctx: Ctx, user: Profile) {
  requireRole(user, 'admin', 'ceo', 'pm');
  const h = await loadWebhook(ctx);
  const last = must(
    await ctx.db.from('bot_messages').select('status, last_error, sent_at, created_at, message').not('quote_id', 'is', null).order('created_at', { ascending: false }).limit(1),
    'last quote message',
  ) as { status: string; last_error: string | null; sent_at: string | null; created_at: string }[];
  return {
    configured: !!h,
    active: !!h?.active,
    label: h?.label ?? '',
    url: h ? maskUrl(h.url) : null,
    signed: !!h?.secret,
    updatedAt: h?.updated_at ?? null,
    last: last[0] ?? null,
  };
}

export async function saveWebhook(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'admin');
  if (body.remove === true) {
    must(await ctx.db.from('lark_webhook').delete().eq('id', 1), 'remove webhook');
    await ctx.db.from('events').insert({ actor: user.id, entity: 'lark_webhook', entity_id: '1', action: 'webhook.removed', payload: {} });
    return webhookStatus(ctx, user);
  }
  const cur = await loadWebhook(ctx);
  const url = String(body.url ?? '').trim() || cur?.url || '';
  if (!WEBHOOK_URL_RE.test(url)) throw new ApiError(400, 'bad_url', 'URL webhook phải có dạng https://open.larksuite.com/open-apis/bot/v2/hook/…');
  const secret = body.secret === undefined ? cur?.secret ?? null : String(body.secret ?? '').trim() || null;
  must(
    await ctx.db.from('lark_webhook').upsert({
      id: 1,
      url,
      secret,
      label: String(body.label ?? cur?.label ?? '').trim().slice(0, 80),
      active: body.active === undefined ? cur?.active ?? true : !!body.active,
      updated_by: user.id,
      updated_at: new Date(ctx.now()).toISOString(),
    }),
    'save webhook',
  );
  await ctx.db.from('events').insert({ actor: user.id, entity: 'lark_webhook', entity_id: '1', action: 'webhook.saved', payload: { signed: !!secret } });
  return webhookStatus(ctx, user);
}

export async function testWebhook(ctx: Ctx, user: Profile) {
  requireRole(user, 'admin');
  const h = await loadWebhook(ctx);
  if (!h) throw new ApiError(400, 'no_webhook', 'Chưa nhập URL webhook.');
  const s = await loadSettings(ctx.db);
  const card = toWebhookCard(
    { tone: 'blue', title: '✅ Go Media Ops Hub đã kết nối nhóm này', lines: [{ icon: '🤖', text: 'Từ giờ các mốc báo giá (gửi duyệt, góp ý, yêu cầu sửa, CEO ký, gửi khách, khách ký) sẽ báo vào đây.' }], note: `Thử lúc ${new Date(ctx.now()).toLocaleString('vi-VN', { timeZone: s.timezone })}` },
    appLink(s, '/quotes'),
    'Mở Ops Hub',
  );
  try {
    await postWebhook(ctx, h, card);
  } catch (e) {
    throw new ApiError(502, 'webhook_failed', (e as Error).message);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------- quote bot --------

export interface QuoteRef {
  id: string;
  code: string;
  client: string;
  created_by: string;
  requested_at: string;
  total?: number | null;
}

async function nameOf(ctx: Ctx, id: string | null | undefined): Promise<string> {
  if (!id) return '';
  const p = (await ctx.db.from('profiles').select('full_name, email').eq('id', id).maybeSingle()).data as { full_name: string; email: string } | null;
  return p?.full_name || p?.email || '';
}

export async function roundsOf(ctx: Ctx, quoteId: string): Promise<number> {
  const res = await ctx.db.from('events').select('id', { count: 'exact', head: true }).eq('entity', 'quotes').eq('entity_id', quoteId).eq('action', 'quote.changes_requested');
  return res.count ?? 0;
}

/**
 * Ghi một tin báo giá (bot_messages) và gửi lên nhóm Lark qua webhook nếu đã cấu hình. Không bao giờ ném
 * lỗi ra ngoài: thông báo hỏng không được làm hỏng thao tác chính trên báo giá.
 */
export async function quoteBot(ctx: Ctx, q: QuoteRef, kind: QuoteBotKind, extra: Partial<QuoteBotInput> = {}, key: string | null = null): Promise<boolean> {
  try {
    const s = await loadSettings(ctx.db);
    const cal = calendarOf(s);
    const input: QuoteBotInput = {
      code: q.code,
      client: q.client,
      accountName: await nameOf(ctx, q.created_by),
      total: q.total ?? null,
      hoursSoFar: workingHoursBetween(Date.parse(q.requested_at), ctx.now(), cal),
      targetHours: Number(s.quote_late_hours) || 8,
      ...extra,
    };
    const message = quoteBotMessage(kind, input);
    const hook = await loadWebhook(ctx);
    const live = !!hook?.active;
    const ins = await ctx.db
      .from('bot_messages')
      .insert({
        quote_id: q.id,
        project_id: null,
        task_id: null,
        kind: `quote_${kind}`,
        channel: 'group',
        chat_id: live ? 'webhook' : 'sim-quotes',
        dedupe_key: key,
        local_date: localDateKey(ctx.now(), s.timezone),
        message,
        status: 'failed',
        attempts: 1,
        last_error: 'đang gửi',
      })
      .select('id')
      .maybeSingle();
    if (ins.error || !ins.data) return false; // trùng khoá: tin này đã gửi rồi
    const id = (ins.data as { id: string }).id;
    try {
      if (live) await postWebhook(ctx, hook!, toWebhookCard(message, appLink(s, `/quotes/${q.id}`)));
      await ctx.db.from('bot_messages').update({ status: live ? 'sent' : 'simulated', last_error: null, sent_at: new Date(ctx.now()).toISOString() }).eq('id', id);
      return true;
    } catch (e) {
      await ctx.db.from('bot_messages').update({ status: 'failed', last_error: (e as Error).message.slice(0, 500) }).eq('id', id);
      return false;
    }
  } catch (e) {
    console.error('quote bot failed', (e as Error).message);
    return false;
  }
}

export const approverLabel = (a: 'pm' | 'ceo' | null | undefined) => (a ? ROLE_LABEL[a] : 'PM/CEO');

// --------------------------------------------------------------------- chữ ký cá nhân --------

export async function setMySignature(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'account', 'pm', 'ceo');
  const image = body.image === null ? null : String(body.image ?? '');
  if (image === null) {
    must(await ctx.db.from('user_signatures').delete().eq('profile_id', user.id), 'remove signature');
  } else {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) throw new ApiError(400, 'invalid', 'Chữ ký phải là ảnh PNG.');
    if (image.length > 400000) throw new ApiError(400, 'too_big', 'Ảnh chữ ký quá lớn (tối đa khoảng 300 KB).');
    must(await ctx.db.from('user_signatures').upsert({ profile_id: user.id, image, updated_at: new Date(ctx.now()).toISOString() }), 'save signature');
  }
  await ctx.db.from('events').insert({ actor: user.id, entity: 'user_signatures', entity_id: user.id, action: image ? 'signature.set' : 'signature.removed', payload: {} });
  return { ok: true };
}

/**
 * Account ký người lập (ghi giờ ký). Ảnh in trên PDF lấy từ Hồ sơ → Chữ ký của tôi; chưa có ảnh thì PDF chỉ in
 * tên và giờ ký, không chặn việc gửi (để không làm gãy luồng đang chạy).
 */
export async function signAsAccount(ctx: Ctx, user: Profile, quoteId: string) {
  must(await ctx.db.from('quotes').update({ account_signed_at: new Date(ctx.now()).toISOString(), account_signed_by: user.id }).eq('id', quoteId), 'account sign');
}

// ------------------------------------------------------------------------- link cho khách --------

export async function clientLink(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const q = must(await ctx.db.from('quotes').select('id, status, created_by, client_token').eq('id', String(body.quote_id ?? '')).maybeSingle(), 'load quote') as {
    id: string;
    status: string;
    created_by: string;
    client_token: string | null;
  } | null;
  if (!q) throw new ApiError(404, 'quote_not_found', 'Không tìm thấy báo giá.');
  if (!(q.created_by === user.id || ['pm', 'ceo'].includes(user.role))) throw new ApiError(403, 'forbidden', 'Chỉ Account lập báo giá, PM hoặc CEO.');
  if (q.status !== 'sent') throw new ApiError(409, 'not_sent', 'Gửi khách xong mới có link cho khách.');
  let token = q.client_token;
  if (!token) {
    token = randomToken(18);
    must(await ctx.db.from('quotes').update({ client_token: token }).eq('id', q.id).is('client_token', null), 'save token');
    token = (must(await ctx.db.from('quotes').select('client_token').eq('id', q.id).single(), 'reload token') as { client_token: string }).client_token;
  }
  const s = await loadSettings(ctx.db);
  return { token, url: appLink(s, `/k/${token}`) };
}

const PUBLIC_QUOTE_COLS =
  'id, code, band_result, approver, client, contact, project, venue, kind, status, sent_at, requested_at, discount_pct, vat_pct, subtotal, total, vat_amount, grand_total, terms, created_by, signed_at, signed_by, account_signed_at, account_signed_by, client_viewed_at, client_signed_at, client_signer_name, client_signer_title, client_signature, client_note';

/** POST /ops-hub/public · không cần đăng nhập; mã link (token) là chìa khoá duy nhất. */
export async function handlePublic(ctx: Ctx, req: Request) {
  if (req.method !== 'POST') throw new ApiError(405, 'method', 'POST only');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = String(body.token ?? '');
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) throw new ApiError(404, 'not_found', 'Link báo giá không đúng hoặc đã hết hiệu lực.');
  const q = must(await ctx.db.from('quotes').select(PUBLIC_QUOTE_COLS).eq('client_token', token).maybeSingle(), 'load public quote') as Record<string, unknown> | null;
  if (!q || q.status !== 'sent') throw new ApiError(404, 'not_found', 'Link báo giá không đúng hoặc đã hết hiệu lực.');
  const ref: QuoteRef = { id: q.id as string, code: q.code as string, client: q.client as string, created_by: q.created_by as string, requested_at: q.requested_at as string, total: Number(q.total) };
  const op = String(body.op ?? 'view');
  const stamp = new Date(ctx.now()).toISOString();

  if (op === 'view') {
    if (!q.client_viewed_at) {
      const first = must(await ctx.db.from('quotes').update({ client_viewed_at: stamp }).eq('id', ref.id).is('client_viewed_at', null).select('id'), 'mark viewed') as unknown[];
      if (first.length) {
        await ctx.db.from('events').insert({ actor: null, entity: 'quotes', entity_id: ref.id, action: 'quote.client_viewed', payload: {} });
        await quoteBot(ctx, ref, 'client_viewed', {}, `quote:${ref.id}:client_viewed`);
        q.client_viewed_at = stamp;
      }
    }
  } else if (op === 'sign' || op === 'changes') {
    if (q.client_signed_at) throw new ApiError(409, 'already_signed', 'Báo giá này đã được ký xác nhận.');
    const name = String(body.name ?? '').trim().slice(0, 120);
    const note = String(body.note ?? '').trim().slice(0, 2000);
    if (!name) throw new ApiError(400, 'name_required', 'Nhập họ tên người đại diện.');
    if (op === 'sign') {
      const image = String(body.signature ?? '');
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 400000) throw new ApiError(400, 'bad_signature', 'Vẽ chữ ký vào khung rồi bấm Ký xác nhận.');
      must(
        await ctx.db
          .from('quotes')
          .update({ client_signed_at: stamp, client_signer_name: name, client_signer_title: String(body.title ?? '').trim().slice(0, 120) || null, client_signature: image, client_note: note || null })
          .eq('id', ref.id)
          .is('client_signed_at', null),
        'client sign',
      );
      await ctx.db.from('events').insert({ actor: null, entity: 'quotes', entity_id: ref.id, action: 'quote.client_signed', payload: { name } });
      await quoteBot(ctx, ref, 'client_signed', { actorName: name }, `quote:${ref.id}:client_signed`);
    } else {
      if (!note) throw new ApiError(400, 'note_required', 'Ghi rõ nội dung cần điều chỉnh.');
      must(await ctx.db.from('quotes').update({ client_note: note, client_signer_name: name }).eq('id', ref.id), 'client changes');
      await ctx.db.from('events').insert({ actor: null, entity: 'quotes', entity_id: ref.id, action: 'quote.client_changes', payload: { name } });
      await quoteBot(ctx, ref, 'client_changes', { actorName: name, body: note });
    }
    return handlePublic(ctx, new Request(req.url, { method: 'POST', body: JSON.stringify({ token, op: 'reload' }) }));
  }

  const lines = must(
    await ctx.db.from('quote_lines').select('id, position, item_name, unit, qty, unit_price, kind, description, section, library_item_id, library_price, override_reason').eq('quote_id', ref.id).order('position'),
    'load lines',
  ) as Record<string, unknown>[];
  const s = (await loadSettings(ctx.db)) as unknown as Record<string, unknown>;
  const ids = [q.created_by, q.account_signed_by].filter(Boolean) as string[];
  const people = (must(await ctx.db.from('profiles').select('id, full_name, email').in('id', ids), 'load people') as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p.full_name || p.email] as const);
  const names = new Map(people);
  const accSig = q.account_signed_by ? ((await ctx.db.from('user_signatures').select('image').eq('profile_id', q.account_signed_by as string).maybeSingle()).data as { image: string } | null) : null;
  const ceoPrinted = !!q.signed_at || (q.kind === 'quick' && !q.approver);
  const ceoSig = ceoPrinted ? ((await ctx.db.from('quote_signature').select('image').eq('id', 1).maybeSingle()).data as { image: string } | null) : null;
  const { created_by: _c, account_signed_by: _a, signed_by: _s, ...pub } = q;
  void _c; void _a; void _s;
  return {
    quote: { ...pub, discount_pct: Number(q.discount_pct), vat_pct: Number(q.vat_pct ?? 0), terms: (q.terms as string[] | null) ?? [] },
    lines: lines.map((l) => ({ ...l, quote_id: ref.id, qty: Number(l.qty), unit_price: Number(l.unit_price) })),
    preparedBy: names.get(q.created_by as string) ?? '',
    company: {
      name: (s.company_legal_name as string)?.trim() || (s.company_name as string) || 'Go Media',
      shortName: (s.company_name as string) || 'Go Media',
      taxCode: (s.company_tax_code as string) ?? '',
      address: (s.company_address as string) ?? '',
      phone: (s.company_phone as string) ?? '',
      website: (s.company_website as string) ?? '',
      signerName: (s.signer_name as string) ?? '',
      signerTitle: (s.signer_title as string) ?? '',
    },
    vatOnPassThrough: !!s.vat_on_pass_through,
    timezone: s.timezone,
    accountSignature: q.account_signed_at && accSig ? { image: accSig.image, name: names.get(q.account_signed_by as string) ?? '', signedAt: q.account_signed_at } : null,
    ceoSignature: ceoPrinted && ceoSig ? { image: ceoSig.image, signedAt: (q.signed_at as string | null) ?? null } : null,
  };
}
