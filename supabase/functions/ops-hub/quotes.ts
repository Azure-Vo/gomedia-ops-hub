// Quote actions. Every rule comes from src/domain; this file loads data, applies the
// decision through one SQL function call, and sends notifications.
import {
  bandCheck,
  BandLevel,
  BandLine,
  isWorkingTime,
  linesMissingOverrideReason,
  nextQuoteStatus,
  PublicBandReason,
  publicBand,
  QuoteStatus,
  quoteTotals,
  ROLE_LABEL,
  validateQuote,
  validateQuoteHistoryRows,
} from '../../../src/domain/index';
import { appLink, calendarOf, Ctx, loadRules, loadSettings, Profile, requireRole } from './context';
import { ApiError, must } from './http';
import { approvalRequestText, decisionText, linkButton } from './messages';

interface LibRow {
  id: string;
  name: string;
  unit: string;
  service_group: string;
  unit_price: number;
  band_low: number | null;
  band_high: number | null;
  active: boolean;
}

interface QuoteRow {
  id: string;
  code: string;
  client: string;
  service_group: string | null;
  status: QuoteStatus;
  requested_at: string;
  discount_pct: number;
  created_by: string;
  approver: 'pm' | 'ceo' | null;
  band_result: BandLevel | null;
  band_detail: { reasons?: PublicBandReason[] } | null;
  total: number;
}

interface LineIn {
  library_item_id: string | null;
  item_name?: string;
  qty: number;
  unit_price: number;
  override_reason?: string | null;
}

const QUOTE_COLS = 'id, code, client, service_group, status, requested_at, discount_pct, created_by, approver, band_result, band_detail, total';

async function libraryMap(ctx: Ctx, ids: (string | null)[]): Promise<Map<string, LibRow>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const rows = must(await ctx.db.from('library_items').select('id, name, unit, service_group, unit_price, band_low, band_high, active').in('id', wanted), 'load library') as LibRow[];
  return new Map(rows.map((r) => [r.id, { ...r, unit_price: Number(r.unit_price), band_low: r.band_low === null ? null : Number(r.band_low), band_high: r.band_high === null ? null : Number(r.band_high) }]));
}

function bandLines(lines: LineIn[], lib: Map<string, LibRow>): BandLine[] {
  return lines.map((l) => {
    const item = l.library_item_id ? lib.get(l.library_item_id) : undefined;
    return {
      name: item?.name ?? l.item_name ?? 'Hạng mục',
      qty: Number(l.qty),
      unitPrice: Number(l.unit_price),
      libraryPrice: item ? item.unit_price : null,
      bandLow: item?.band_low ?? null,
      bandHigh: item?.band_high ?? null,
    };
  });
}

function checkLinesShape(lines: unknown): LineIn[] {
  if (!Array.isArray(lines) || lines.length > 200) throw new ApiError(400, 'bad_lines', 'Danh sách hạng mục không hợp lệ.');
  return lines.map((l) => {
    const x = l as Record<string, unknown>;
    const qty = Number(x.qty);
    const price = Number(x.unit_price);
    if (!(qty > 0) || !(price >= 0) || !Number.isFinite(qty) || !Number.isFinite(price)) throw new ApiError(400, 'bad_lines', 'Số lượng phải > 0 và đơn giá ≥ 0.');
    return { library_item_id: (x.library_item_id as string) || null, item_name: String(x.item_name ?? ''), qty, unit_price: Math.round(price), override_reason: (x.override_reason as string) ?? null };
  });
}

async function loadQuote(ctx: Ctx, id: string): Promise<QuoteRow> {
  const q = must(await ctx.db.from('quotes').select(QUOTE_COLS).eq('id', id).maybeSingle(), 'load quote') as QuoteRow | null;
  if (!q) throw new ApiError(404, 'quote_not_found', 'Không tìm thấy báo giá.');
  return { ...q, discount_pct: Number(q.discount_pct), total: Number(q.total) };
}

async function loadLines(ctx: Ctx, quoteId: string): Promise<LineIn[]> {
  const rows = must(
    await ctx.db.from('quote_lines').select('library_item_id, item_name, qty, unit_price, override_reason').eq('quote_id', quoteId).order('position'),
    'load lines',
  ) as LineIn[];
  return rows.map((r) => ({ ...r, qty: Number(r.qty), unit_price: Number(r.unit_price) }));
}

function own(user: Profile, q: QuoteRow) {
  requireRole(user, 'account');
  if (q.created_by !== user.id) throw new ApiError(403, 'not_owner', 'Đây không phải báo giá của bạn.');
}

async function transition(ctx: Ctx, p: Record<string, unknown>) {
  const res = await ctx.db.rpc('ops_quote_transition', { p });
  if (res.error && /conflict/.test(res.error.message)) throw new ApiError(409, 'conflict', 'Báo giá vừa được thay đổi ở nơi khác. Tải lại trang rồi thử lại.');
  return must(res, 'quote transition') as Record<string, unknown>;
}

/** Lines plus band and totals; an approved quote is sent exactly as approved (no new price checks). */
async function readyLines(ctx: Ctx, q: QuoteRow) {
  const lines = await loadLines(ctx, q.id);
  const lib = await libraryMap(ctx, lines.map((l) => l.library_item_id));
  const errors = validateQuote({
    client: q.client,
    requestedAt: Date.parse(q.requested_at),
    now: ctx.now(),
    lines: lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })),
    discountPct: q.discount_pct,
  });
  if (q.status !== 'approved') {
    const missing = linesMissingOverrideReason(
      lines.map((l) => ({ unitPrice: l.unit_price, libraryPrice: l.library_item_id ? lib.get(l.library_item_id)?.unit_price ?? null : null, overrideReason: l.override_reason })),
    );
    if (missing.length) errors.push(`Ghi lý do cho đơn giá khác thư viện ở dòng ${missing.map((i) => i + 1).join(', ')}.`);
  }
  if (errors.length) throw new ApiError(400, 'invalid_quote', errors.join(' '));
  const rules = await loadRules(ctx.db);
  const band = bandCheck(bandLines(lines, lib), q.discount_pct, rules);
  return { lines, band, totals: quoteTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })), q.discount_pct) };
}

export async function previewBand(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'account', 'pm', 'ceo');
  const lines = checkLinesShape(body.lines ?? []);
  const lib = await libraryMap(ctx, lines.map((l) => l.library_item_id));
  const discount = Number(body.discount_pct ?? 0);
  let result;
  try {
    result = bandCheck(bandLines(lines, lib), discount, await loadRules(ctx.db));
  } catch (err) {
    throw new ApiError(400, 'bad_input', (err as Error).message === 'Discount must be between 0 and 100%' ? 'Chiết khấu phải từ 0 đến 100%.' : 'Dữ liệu báo giá không hợp lệ.');
  }
  const libraryPrices = lines.map((l) => (l.library_item_id ? lib.get(l.library_item_id)?.unit_price ?? null : null));
  return user.role === 'ceo' ? { band: publicBand(result), full: result, libraryPrices } : { band: publicBand(result), libraryPrices };
}

export async function notifyApproval(ctx: Ctx, quoteId: string): Promise<boolean> {
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return false;
  const claimed = must(
    await ctx.db
      .from('quotes')
      .update({ approval_notified_at: new Date(ctx.now()).toISOString() })
      .eq('id', quoteId)
      .eq('status', 'pending')
      .is('approval_notified_at', null)
      .select(QUOTE_COLS),
    'claim approval notice',
  ) as QuoteRow[];
  const q = claimed[0];
  if (!q || !q.approver) return false;
  const account = (await ctx.db.from('profiles').select('full_name, email').eq('id', q.created_by).maybeSingle()).data as { full_name: string; email: string } | null;
  const text = approvalRequestText({
    code: q.code,
    client: q.client,
    total: Number(q.total),
    level: q.approver as BandLevel,
    accountName: account?.full_name || account?.email || '',
    reasons: q.band_detail?.reasons ?? [],
  });
  await ctx.notifier.sendToRoles([q.approver], text, linkButton('Mở hàng chờ duyệt', appLink(s, '/approvals')));
  return true;
}

export async function deliverPendingApprovals(ctx: Ctx): Promise<number> {
  const rows = must(await ctx.db.from('quotes').select('id').eq('status', 'pending').is('approval_notified_at', null).limit(50), 'pending approvals') as { id: string }[];
  let n = 0;
  for (const r of rows) if (await notifyApproval(ctx, r.id)) n++;
  return n;
}

export async function submitQuote(ctx: Ctx, user: Profile, quoteId: string) {
  const q = await loadQuote(ctx, quoteId);
  own(user, q);
  const { band, totals } = await readyLines(ctx, q);
  const t = nextQuoteStatus(q.status, 'submit', band.level);
  if (!t.ok) throw new ApiError(409, 'bad_transition', t.error);
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: q.status,
    new_status: t.status,
    actor: user.id,
    fields: { band_result: band.level, band_detail: publicBand(band), approver: band.level, approval_requested: true, subtotal: totals.subtotal, total: totals.total },
    event_action: 'quote.submitted',
    event_payload: { band: band.level, total: totals.total },
  });
  await notifyApproval(ctx, q.id);
  return { quote };
}

export async function reopenQuote(ctx: Ctx, user: Profile, quoteId: string) {
  const q = await loadQuote(ctx, quoteId);
  own(user, q);
  if (q.status === 'draft') return { quote: q };
  const t = nextQuoteStatus(q.status, 'edit');
  if (!t.ok) throw new ApiError(409, 'bad_transition', t.error);
  const quote = await transition(ctx, { quote_id: q.id, expected_status: q.status, new_status: t.status, actor: user.id, event_action: 'quote.reopened' });
  return { quote };
}

export async function decideQuote(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'pm', 'ceo');
  const q = await loadQuote(ctx, String(body.quote_id ?? ''));
  if (q.status !== 'pending') throw new ApiError(409, 'not_pending', 'Báo giá này không còn chờ duyệt.');
  if (q.approver !== user.role) throw new ApiError(403, 'wrong_approver', `Báo giá này chờ ${ROLE_LABEL[q.approver ?? 'ceo']} duyệt.`);
  const decision = body.decision === 'approve' ? 'approve' : body.decision === 'changes' ? 'changes' : null;
  if (!decision) throw new ApiError(400, 'bad_decision', 'Chọn Duyệt hoặc Yêu cầu sửa.');
  const comment = String(body.comment ?? '').trim();
  if (decision === 'changes' && !comment) throw new ApiError(400, 'comment_required', 'Hãy ghi nhận xét để Account biết cần sửa gì.');
  const t = nextQuoteStatus(q.status, decision === 'approve' ? 'approve' : 'request_changes');
  if (!t.ok) throw new ApiError(409, 'bad_transition', t.error);
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: 'pending',
    new_status: t.status,
    actor: user.id,
    approval: { level: q.approver, approver_id: user.id, decision, comment },
    event_action: decision === 'approve' ? 'quote.approved' : 'quote.changes_requested',
    event_payload: { comment },
  });
  const s = await loadSettings(ctx.db);
  if (isWorkingTime(ctx.now(), calendarOf(s))) {
    await ctx.notifier.send(q.created_by, decisionText({ code: q.code, decision, approverRole: user.role, comment: comment || null }), linkButton('Mở báo giá', appLink(s, `/quotes/${q.id}`)));
  }
  return { quote };
}

export async function sendQuote(ctx: Ctx, user: Profile, quoteId: string) {
  const q = await loadQuote(ctx, quoteId);
  own(user, q);
  const { band, totals } = await readyLines(ctx, q);
  const t = nextQuoteStatus(q.status, 'send', q.status === 'approved' ? q.band_result ?? undefined : band.level);
  if (!t.ok) throw new ApiError(409, 'bad_transition', t.error);
  const fields: Record<string, unknown> = { subtotal: totals.subtotal, total: totals.total };
  if (q.status !== 'approved') Object.assign(fields, { band_result: band.level, band_detail: publicBand(band) });
  const quote = await transition(ctx, {
    quote_id: q.id,
    expected_status: q.status,
    new_status: 'sent',
    actor: user.id,
    fields,
    event_action: 'quote.sent',
    event_payload: { total: totals.total, band: q.status === 'approved' ? q.band_result : band.level },
  });
  return { quote };
}

export async function importQuotes(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'pm', 'admin');
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length > 5000) throw new ApiError(400, 'bad_rows', 'File không hợp lệ hoặc quá lớn (tối đa 5000 dòng).');
  const s = await loadSettings(ctx.db);
  const { quotes, errors } = validateQuoteHistoryRows(rows as Record<string, string>[], s.timezone);
  const lib = must(await ctx.db.from('library_items').select('id, name, unit, unit_price'), 'load library') as { id: string; name: string; unit: string; unit_price: number }[];
  const byNameUnit = new Map(lib.map((i) => [`${i.name.trim().toLowerCase()}|${i.unit.trim().toLowerCase()}`, i]));
  const byName = new Map(lib.map((i) => [i.name.trim().toLowerCase(), i]));
  const unmatched = new Set<string>();
  const payload = quotes.map((q) => {
    const totals = quoteTotals(q.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })), q.discountPct);
    return {
      code: q.code,
      client: q.client,
      service_group: q.serviceGroup,
      requested_at: new Date(q.requestedAt).toISOString(),
      sent_at: new Date(q.sentAt).toISOString(),
      discount_pct: q.discountPct,
      subtotal: totals.subtotal,
      total: totals.total,
      lines: q.lines.map((l) => {
        const item = byNameUnit.get(`${l.itemName.toLowerCase()}|${l.unit.toLowerCase()}`) ?? byName.get(l.itemName.toLowerCase());
        if (!item) unmatched.add(l.itemName);
        return { library_item_id: item?.id ?? null, item_name: l.itemName, unit: l.unit, qty: l.qty, unit_price: l.unitPrice, library_price: item ? Number(item.unit_price) : null };
      }),
    };
  });
  const firstRequested = quotes.length ? Math.min(...quotes.map((q) => q.requestedAt)) : null;
  const lastSent = quotes.length ? Math.max(...quotes.map((q) => q.sentAt)) : null;
  const summary = {
    quotes: payload.length,
    lines: payload.reduce((n, q) => n + q.lines.length, 0),
    errors,
    unmatchedItems: [...unmatched],
    // Shown back to the user so a day/month swap (US-style dates from Excel) is visible before saving.
    range: firstRequested === null ? null : { from: new Date(firstRequested).toISOString(), to: new Date(lastSent as number).toISOString() },
    sample: payload.slice(0, 3).map((q) => ({ code: q.code, requested_at: q.requested_at, sent_at: q.sent_at })),
  };
  if (body.dryRun) return { preview: summary };
  if (!payload.length) throw new ApiError(400, 'nothing_to_import', 'Không có báo giá hợp lệ để nhập.');
  const result = must(await ctx.db.rpc('ops_import_quotes', { p: { actor: user.id, quotes: payload } }), 'import quotes');
  return { preview: summary, result };
}
