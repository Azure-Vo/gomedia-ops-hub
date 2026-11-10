// Review comments on a quote: the PM / CEO opens the quote by its link and comments on a line,
// a section or a block; the Account replies and marks each comment done. Rules live in src/domain.
import { anchorLabel, canComment, COMMENT_ANCHORS, CommentAnchor, isWorkingTime, QuoteStatus, validateCommentBody } from '../../../src/domain/index';
import { appLink, calendarOf, Ctx, loadSettings, logEvent, Profile } from './context';
import { ApiError, must } from './http';
import { commentText, linkButton } from './messages';

interface QuoteLite {
  id: string;
  code: string;
  client: string;
  status: QuoteStatus;
  created_by: string;
  approver: 'pm' | 'ceo' | null;
}

interface CommentRow {
  id: string;
  quote_id: string;
  parent_id: string | null;
  author_id: string;
  anchor: CommentAnchor;
  line_id: string | null;
  section_title: string | null;
  anchor_label: string;
  body: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

const COMMENT_COLS = 'id, quote_id, parent_id, author_id, anchor, line_id, section_title, anchor_label, body, resolved_at, resolved_by, created_at';
/** One message per person per quote in this window, however many comments are written. */
const NOTIFY_GAP_MS = 10 * 60_000;

async function quoteFor(ctx: Ctx, user: Profile, id: string): Promise<QuoteLite> {
  const q = must(await ctx.db.from('quotes').select('id, code, client, status, created_by, approver').eq('id', id).maybeSingle(), 'load quote') as QuoteLite | null;
  if (!q) throw new ApiError(404, 'quote_not_found', 'Không tìm thấy báo giá.');
  if (q.status === 'sent') throw new ApiError(409, 'quote_sent', 'Báo giá đã gửi khách, không góp ý thêm được.');
  if (!canComment(user.role, q.created_by === user.id, q.status)) throw new ApiError(403, 'forbidden', 'Chỉ PM, CEO và Account lập báo giá này mới góp ý được.');
  return q;
}

/** Open (unresolved) threads on a quote; used to gate approving and sending. */
export async function openThreadCount(ctx: Ctx, quoteId: string): Promise<number> {
  const res = await ctx.db.from('quote_comments').select('id', { count: 'exact', head: true }).eq('quote_id', quoteId).is('parent_id', null).is('resolved_at', null);
  if (res.error) throw new Error(`count open comments: ${res.error.message}`);
  return res.count ?? 0;
}

async function notify(ctx: Ctx, q: QuoteLite, author: Profile, c: CommentRow, root: CommentRow | null) {
  // Who should hear about it: a reviewer's comment goes to the Account; the Account's goes to the
  // reviewer in the thread, or to the approving level while the quote waits for approval.
  const to = new Set<string>();
  if (author.id !== q.created_by) to.add(q.created_by);
  else if (root && root.author_id !== author.id) to.add(root.author_id);
  else if (q.status === 'pending' && q.approver) {
    const rows = must(await ctx.db.from('profiles').select('id').eq('role', q.approver).eq('active', true), 'load approvers') as { id: string }[];
    for (const r of rows) to.add(r.id);
  }
  to.delete(author.id);
  if (!to.size) return;
  const s = await loadSettings(ctx.db);
  if (!isWorkingTime(ctx.now(), calendarOf(s))) return;
  // The time is kept in the payload (the function's own clock), so the gap does not depend on the database clock.
  const recent = must(
    await ctx.db.from('events').select('payload').eq('entity', 'quotes').eq('entity_id', q.id).eq('action', 'quote.comment_notified').order('id', { ascending: false }).limit(50),
    'recent comment notices',
  ) as { payload: { to?: string; at?: number } | null }[];
  const told = new Set(recent.filter((r) => Math.abs(ctx.now() - Number(r.payload?.at ?? 0)) < NOTIFY_GAP_MS).map((r) => r.payload?.to));
  const text = commentText({ code: q.code, client: q.client, authorName: author.full_name || author.email, place: c.anchor_label, body: c.body, reply: !!root });
  for (const userId of to) {
    if (told.has(userId)) continue;
    const res = await ctx.notifier.send(userId, text, linkButton('Mở báo giá', appLink(s, `/quotes/${q.id}`)));
    if (res.delivered) await logEvent(ctx.db, author.id, 'quotes', q.id, 'quote.comment_notified', { to: userId, at: ctx.now() });
  }
}

export async function addComment(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const q = await quoteFor(ctx, user, String(body.quote_id ?? ''));
  const text = validateCommentBody(body.body);
  if (!text.ok) throw new ApiError(400, 'bad_comment', text.error);

  let row: Record<string, unknown>;
  let root: CommentRow | null = null;
  if (body.parent_id) {
    root = must(await ctx.db.from('quote_comments').select(COMMENT_COLS).eq('id', String(body.parent_id)).maybeSingle(), 'load thread') as CommentRow | null;
    if (!root || root.quote_id !== q.id || root.parent_id) throw new ApiError(400, 'bad_parent', 'Không tìm thấy góp ý để trả lời.');
    row = { quote_id: q.id, parent_id: root.id, author_id: user.id, anchor: root.anchor, line_id: root.line_id, section_title: root.section_title, anchor_label: root.anchor_label, body: text.body };
  } else {
    const anchor = COMMENT_ANCHORS.includes(body.anchor as CommentAnchor) ? (body.anchor as CommentAnchor) : 'general';
    let lineId: string | null = null;
    let sectionTitle: string | null = null;
    let label = anchorLabel({ anchor });
    if (anchor === 'line') {
      const line = must(
        await ctx.db.from('quote_lines').select('id, quote_id, position, item_name').eq('id', String(body.line_id ?? '')).maybeSingle(),
        'load line',
      ) as { id: string; quote_id: string; position: number; item_name: string } | null;
      if (!line || line.quote_id !== q.id) throw new ApiError(400, 'bad_line', 'Dòng này không còn trong báo giá. Tải lại trang rồi thử lại.');
      lineId = line.id;
      label = anchorLabel({ anchor, position: line.position, itemName: line.item_name });
    } else if (anchor === 'section') {
      sectionTitle = String(body.section_title ?? '').trim().slice(0, 200);
      if (!sectionTitle) throw new ApiError(400, 'bad_section', 'Thiếu tên phần cần góp ý.');
      label = anchorLabel({ anchor, sectionTitle });
    }
    row = { quote_id: q.id, author_id: user.id, anchor, line_id: lineId, section_title: sectionTitle, anchor_label: label, body: text.body };
  }
  const comment = must(await ctx.db.from('quote_comments').insert(row).select(COMMENT_COLS).single(), 'save comment') as CommentRow;
  // A reply to a thread already marked done means it is not done after all.
  if (root?.resolved_at) {
    must(await ctx.db.from('quote_comments').update({ resolved_at: null, resolved_by: null }).eq('id', root.id).select('id'), 'reopen thread');
  }
  await logEvent(ctx.db, user.id, 'quotes', q.id, root ? 'quote.comment_replied' : 'quote.commented', { comment_id: comment.id, anchor: comment.anchor, label: comment.anchor_label });
  try {
    await notify(ctx, q, user, comment, root);
  } catch (err) {
    console.error('comment notice failed', err);
  }
  return { comment, reopened: !!root?.resolved_at };
}

export async function resolveComment(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const c = must(await ctx.db.from('quote_comments').select(COMMENT_COLS).eq('id', String(body.comment_id ?? '')).maybeSingle(), 'load comment') as CommentRow | null;
  if (!c) throw new ApiError(404, 'comment_not_found', 'Không tìm thấy góp ý.');
  if (c.parent_id) throw new ApiError(400, 'not_a_thread', 'Chỉ đánh dấu được góp ý gốc, không phải câu trả lời.');
  const q = await quoteFor(ctx, user, c.quote_id);
  const resolved = body.resolved !== false;
  if (resolved === !!c.resolved_at) return { comment: c };
  const comment = must(
    await ctx.db
      .from('quote_comments')
      .update(resolved ? { resolved_at: new Date(ctx.now()).toISOString(), resolved_by: user.id } : { resolved_at: null, resolved_by: null })
      .eq('id', c.id)
      .select(COMMENT_COLS)
      .single(),
    'update comment',
  ) as CommentRow;
  await logEvent(ctx.db, user.id, 'quotes', q.id, resolved ? 'quote.comment_resolved' : 'quote.comment_reopened', { comment_id: c.id, label: c.anchor_label });
  return { comment };
}
