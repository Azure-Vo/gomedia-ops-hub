// Review on the quote itself: who may comment, how threads group, and how open comments
// gate approving and sending. The PM / CEO opens the quote by its link, comments on the exact
// line or block, and the Account fixes and marks each comment done.
import type { QuoteStatus } from './quote';

export type CommentAnchor = 'general' | 'client' | 'line' | 'section' | 'totals' | 'terms';

export const COMMENT_ANCHORS: CommentAnchor[] = ['general', 'client', 'line', 'section', 'totals', 'terms'];

export const ANCHOR_LABEL: Record<Exclude<CommentAnchor, 'line' | 'section'>, string> = {
  general: 'Cả báo giá',
  client: 'Thông tin khách hàng',
  totals: 'Chiết khấu, thuế và tổng tiền',
  terms: 'Điều khoản và ghi chú',
};

export const COMMENT_MAX_LENGTH = 2000;

export interface ReviewComment {
  id: string;
  parentId: string | null;
  authorId: string;
  anchor: CommentAnchor;
  lineId: string | null;
  sectionTitle: string | null;
  anchorLabel: string;
  body: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export interface ReviewThread {
  root: ReviewComment;
  replies: ReviewComment[];
  open: boolean;
}

/** PM and CEO review; the Account who made the quote answers. A sent quote is history: no new comments. */
export function canComment(role: string, isOwner: boolean, status: QuoteStatus): boolean {
  if (status === 'sent') return false;
  return role === 'pm' || role === 'ceo' || (role === 'account' && isOwner);
}

/** Snapshot label stored with a comment, so it still reads right after the line moves or is deleted. */
export function anchorLabel(a: { anchor: CommentAnchor; position?: number | null; itemName?: string | null; sectionTitle?: string | null }): string {
  if (a.anchor === 'line') return `Dòng ${a.position ?? '?'} · ${(a.itemName ?? '').trim() || 'Hạng mục'}`;
  if (a.anchor === 'section') return `Phần · ${(a.sectionTitle ?? '').trim() || 'Hạng mục dịch vụ'}`;
  return ANCHOR_LABEL[a.anchor];
}

export function validateCommentBody(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return { ok: false, error: 'Hãy viết nội dung góp ý.' };
  if (text.length > COMMENT_MAX_LENGTH) return { ok: false, error: `Góp ý dài tối đa ${COMMENT_MAX_LENGTH} ký tự.` };
  return { ok: true, body: text };
}

/** Roots oldest first, each with its replies oldest first. Replies whose root is missing are dropped. */
export function buildThreads(comments: ReviewComment[]): ReviewThread[] {
  const byTime = (a: ReviewComment, b: ReviewComment) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
  const roots = comments.filter((c) => !c.parentId).sort(byTime);
  const replies = new Map<string, ReviewComment[]>();
  for (const c of comments.filter((x) => x.parentId).sort(byTime)) {
    const list = replies.get(c.parentId as string) ?? [];
    list.push(c);
    replies.set(c.parentId as string, list);
  }
  return roots.map((root) => ({ root, replies: replies.get(root.id) ?? [], open: !root.resolvedAt }));
}

export function openThreadCount(comments: ReviewComment[]): number {
  return comments.filter((c) => !c.parentId && !c.resolvedAt).length;
}

/**
 * Where a thread shows on the quote: on its line or section while that still exists, otherwise
 * with the general comments (a deleted line or a renamed section must not hide a comment).
 */
export function threadPlacement(root: ReviewComment, existing: { lineIds: Set<string>; sectionTitles: Set<string> }): CommentAnchor {
  if (root.anchor === 'line') return root.lineId && existing.lineIds.has(root.lineId) ? 'line' : 'general';
  if (root.anchor === 'section') return root.sectionTitle && existing.sectionTitles.has(root.sectionTitle) ? 'section' : 'general';
  return root.anchor;
}

export type Gate = { ok: true } | { ok: false; error: string };

/** Approving means nothing is left to fix: every comment must be marked done first. */
export function approveGate(openThreads: number): Gate {
  if (openThreads > 0) return { ok: false, error: `Còn ${openThreads} góp ý chưa xử lý. Đánh dấu đã xử lý trước khi duyệt, hoặc chọn Yêu cầu sửa.` };
  return { ok: true };
}

/** Asking for changes needs something to act on: a note, or at least one open comment on the quote. */
export function requestChangesGate(note: string, openThreads: number): Gate {
  if (!note.trim() && openThreads === 0) return { ok: false, error: 'Hãy ghi nhận xét, hoặc góp ý trực tiếp trên báo giá, để Account biết cần sửa gì.' };
  return { ok: true };
}

/** A quote does not go to the client while a review comment is still open. */
export function sendGate(openThreads: number): Gate {
  if (openThreads > 0) return { ok: false, error: `Còn ${openThreads} góp ý chưa xử lý trên báo giá. Xử lý và đánh dấu xong trước khi gửi khách.` };
  return { ok: true };
}

/** Text stored as the decision note when the approver asked for changes through comments only. */
export function changesSummary(note: string, openThreads: number): string {
  const text = note.trim();
  if (text) return text;
  return `${openThreads} góp ý trên báo giá`;
}
