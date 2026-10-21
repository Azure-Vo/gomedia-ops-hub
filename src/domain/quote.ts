// Quote maths, lifecycle and reuse rules.
import type { BandLevel } from './band';

export interface PricedLine {
  qty: number;
  unitPrice: number;
}

export interface QuoteTotals {
  subtotal: number;
  discountAmount: number;
  total: number;
}

/** VND has no minor unit: every amount is rounded to a whole đồng. */
export function lineAmount(line: PricedLine): number {
  return Math.round(line.qty * line.unitPrice);
}

/** 12 × 1.500.000 + 8 × 600.000 + 3 × 2.000.000, discount 5% → 27.360.000 đ. */
export function quoteTotals(lines: PricedLine[], discountPct: number): QuoteTotals {
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const discountAmount = Math.round((subtotal * (Number(discountPct) || 0)) / 100);
  return { subtotal, discountAmount, total: subtotal - discountAmount };
}

export type QuoteStatus = 'draft' | 'pending' | 'approved' | 'changes_requested' | 'sent';
export type QuoteEvent = 'edit' | 'submit' | 'approve' | 'request_changes' | 'send';

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Nháp',
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  changes_requested: 'Yêu cầu sửa',
  sent: 'Đã gửi',
};

export type Transition = { ok: true; status: QuoteStatus } | { ok: false; error: string };

/**
 * Lifecycle: Draft → Sent (in band) or Draft → Pending → Approved → Sent;
 * Pending → Changes requested → Draft. Any edit after Pending or Approved returns to Draft.
 */
export function nextQuoteStatus(status: QuoteStatus, event: QuoteEvent, band?: BandLevel): Transition {
  const fail = (error: string): Transition => ({ ok: false, error });
  switch (event) {
    case 'edit':
      if (status === 'sent') return fail('Báo giá đã gửi không sửa được. Hãy tạo báo giá mới (có thể chép hạng mục).');
      return { ok: true, status: 'draft' };
    case 'submit':
      if (status !== 'draft') return fail('Chỉ gửi duyệt được báo giá đang ở trạng thái Nháp.');
      if (!band) return fail('Chưa có kết quả kiểm tra khung giá.');
      if (band === 'send_now') return fail('Báo giá nằm trong khung giá, có thể gửi ngay, không cần duyệt.');
      return { ok: true, status: 'pending' };
    case 'approve':
      if (status !== 'pending') return fail('Chỉ duyệt được báo giá đang chờ duyệt.');
      return { ok: true, status: 'approved' };
    case 'request_changes':
      if (status !== 'pending') return fail('Chỉ yêu cầu sửa được báo giá đang chờ duyệt.');
      return { ok: true, status: 'changes_requested' };
    case 'send':
      if (status === 'approved') return { ok: true, status: 'sent' };
      if (status === 'draft' && band === 'send_now') return { ok: true, status: 'sent' };
      if (status === 'draft') return fail('Báo giá ngoài khung giá phải được duyệt trước khi gửi.');
      return fail('Báo giá ở trạng thái này chưa gửi được.');
  }
}

/** Statuses in which the owner may change lines and discount without reopening. */
export function isDirectlyEditable(status: QuoteStatus): boolean {
  return status === 'draft' || status === 'changes_requested';
}

export interface QuoteValidationInput {
  client: string;
  requestedAt: number | null;
  now: number;
  lines: PricedLine[];
  discountPct: number;
}

/** Problems that block submitting or sending, in Vietnamese. */
export function validateQuote(q: QuoteValidationInput): string[] {
  const errors: string[] = [];
  if (!q.client.trim()) errors.push('Nhập tên khách hàng.');
  if (q.requestedAt === null) errors.push('Nhập thời điểm khách gửi yêu cầu.');
  else if (q.requestedAt > q.now + 60_000) errors.push('Thời điểm khách gửi yêu cầu không được ở tương lai.');
  if (!q.lines.length) errors.push('Thêm ít nhất một hạng mục.');
  if (q.lines.some((l) => !(l.qty > 0))) errors.push('Số lượng mỗi dòng phải lớn hơn 0.');
  if (q.lines.some((l) => !(l.unitPrice >= 0))) errors.push('Đơn giá không hợp lệ.');
  if (!(q.discountPct >= 0 && q.discountPct <= 100)) errors.push('Chiết khấu phải từ 0 đến 100%.');
  return errors;
}

/** Lines whose unit price differs from the library but carry no override reason (0-based). */
export function linesMissingOverrideReason(
  lines: { unitPrice: number; libraryPrice: number | null; overrideReason?: string | null }[],
): number[] {
  return lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.libraryPrice !== null && l.unitPrice !== l.libraryPrice && !(l.overrideReason ?? '').trim())
    .map(({ i }) => i);
}

export interface LibraryPrice {
  id: string;
  name: string;
  unit: string;
  unitPrice: number;
  active: boolean;
}

export interface SourceLine {
  libraryItemId: string | null;
  itemName: string;
  qty: number;
}

export interface CopiedLine {
  libraryItemId: string;
  itemName: string;
  unit: string;
  qty: number;
  unitPrice: number;
  libraryPrice: number;
}

/** Copies a past quote's scope with TODAY's library prices; lines whose item is gone are skipped. */
export function copyLinesWithTodayPrices(
  source: SourceLine[],
  library: Map<string, LibraryPrice>,
): { lines: CopiedLine[]; skipped: string[] } {
  const lines: CopiedLine[] = [];
  const skipped: string[] = [];
  for (const s of source) {
    const item = s.libraryItemId ? library.get(s.libraryItemId) : undefined;
    if (!item || !item.active) {
      skipped.push(s.itemName);
      continue;
    }
    lines.push({ libraryItemId: item.id, itemName: item.name, unit: item.unit, qty: s.qty, unitPrice: item.unitPrice, libraryPrice: item.unitPrice });
  }
  return { lines, skipped };
}

export interface ArchiveQuote {
  id: string;
  serviceGroup: string | null;
  itemIds: string[];
  sentAt: number;
}

export interface RankedQuote {
  id: string;
  sameGroup: boolean;
  sharedItems: number;
}

/** Similar quotes: same service group first, then by number of shared library items, newest first. */
export function rankSimilar(
  target: { serviceGroup: string | null; itemIds: string[]; excludeId?: string },
  archive: ArchiveQuote[],
  top = 3,
): RankedQuote[] {
  const mine = new Set(target.itemIds);
  return archive
    .filter((q) => q.id !== target.excludeId)
    .map((q) => ({
      q,
      sameGroup: !!target.serviceGroup && q.serviceGroup === target.serviceGroup,
      sharedItems: new Set(q.itemIds.filter((id) => mine.has(id))).size,
    }))
    .filter((x) => x.sameGroup || x.sharedItems > 0 || (!target.serviceGroup && mine.size === 0))
    .sort((a, b) => Number(b.sameGroup) - Number(a.sameGroup) || b.sharedItems - a.sharedItems || b.q.sentAt - a.q.sentAt)
    .slice(0, top)
    .map((x) => ({ id: x.q.id, sameGroup: x.sameGroup, sharedItems: x.sharedItems }));
}
