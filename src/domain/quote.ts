// Quote maths, lifecycle and reuse rules.
import type { BandLevel } from './band';

/** A line is either a service Go Media sells, or money passed through for the client (e.g. an ads budget). */
export type LineKind = 'service' | 'pass_through';

export const LINE_KIND_LABEL: Record<LineKind, string> = { service: 'Dịch vụ', pass_through: 'Chi hộ' };

export interface PricedLine {
  qty: number;
  unitPrice: number;
  /** Default 'service'. Pass-through lines get no discount and, unless the setting says so, no VAT. */
  kind?: LineKind;
}

export interface VatOptions {
  /** VAT rate in % (0–100), snapshotted on the quote when it is created. */
  pct: number;
  /** Whether VAT is also charged on pass-through lines (company setting, default no). */
  onPassThrough?: boolean;
}

export interface QuoteTotals {
  /** Every line, before discount (Cộng tiền hàng). */
  subtotal: number;
  serviceSubtotal: number;
  passThrough: number;
  /** Discount applies to service lines only. */
  discountAmount: number;
  /** subtotal − discount, before VAT. */
  total: number;
  vatPct: number;
  vatAmount: number;
  /** What the client pays (Tổng thanh toán). */
  grandTotal: number;
}

/** VND has no minor unit: every amount is rounded to a whole đồng. */
export function lineAmount(line: PricedLine): number {
  return Math.round(line.qty * line.unitPrice);
}

export function isPassThrough(line: { kind?: LineKind | null }): boolean {
  return line.kind === 'pass_through';
}

/**
 * 12 × 1.500.000 + 8 × 600.000 + 3 × 2.000.000, discount 5% → 27.360.000 đ before VAT;
 * with VAT 8% → 29.548.800 đ. Pass-through lines are added after the discount and outside VAT
 * (unless vat.onPassThrough).
 */
export function quoteTotals(lines: PricedLine[], discountPct: number, vat?: VatOptions): QuoteTotals {
  const serviceSubtotal = lines.filter((l) => !isPassThrough(l)).reduce((s, l) => s + lineAmount(l), 0);
  const passThrough = lines.filter(isPassThrough).reduce((s, l) => s + lineAmount(l), 0);
  const subtotal = serviceSubtotal + passThrough;
  const discountAmount = Math.round((serviceSubtotal * (Number(discountPct) || 0)) / 100);
  const total = subtotal - discountAmount;
  const vatPct = Number(vat?.pct) || 0;
  const vatBase = serviceSubtotal - discountAmount + (vat?.onPassThrough ? passThrough : 0);
  const vatAmount = Math.round((vatBase * vatPct) / 100);
  return { subtotal, serviceSubtotal, passThrough, discountAmount, total, vatPct, vatAmount, grandTotal: total + vatAmount };
}

export interface SectionedLine {
  section?: string | null;
  qty: number;
  unitPrice: number;
}

export interface QuoteSection<T> {
  title: string;
  /** Lines of this section with their index in the original list. */
  lines: { line: T; index: number }[];
  amount: number;
}

export const DEFAULT_SECTION_TITLE = 'Hạng mục dịch vụ';

/** Groups lines by section title, in order of first appearance; an empty title falls into the default section. */
export function groupBySection<T extends SectionedLine>(lines: T[]): QuoteSection<T>[] {
  const out: QuoteSection<T>[] = [];
  const at = new Map<string, QuoteSection<T>>();
  lines.forEach((line, index) => {
    const title = (line.section ?? '').trim() || DEFAULT_SECTION_TITLE;
    let sec = at.get(title);
    if (!sec) {
      sec = { title, lines: [], amount: 0 };
      at.set(title, sec);
      out.push(sec);
    }
    sec.lines.push({ line, index });
    sec.amount += lineAmount(line);
  });
  return out;
}

/** 1 → I, 4 → IV, 9 → IX … for section numbering on the quote. */
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0) return String(n);
  const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let r = '';
  for (const [v, s] of map) while (n >= v) { r += s; n -= v; }
  return r;
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
  vatPct?: number;
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
  if (q.vatPct !== undefined && !(q.vatPct >= 0 && q.vatPct <= 100)) errors.push('Thuế GTGT phải từ 0 đến 100%.');
  return errors;
}

/**
 * Lines whose unit price differs from the library but carry no override reason (0-based).
 * Pass-through lines are exempt: the library amount is only a suggested budget.
 */
export function linesMissingOverrideReason(
  lines: { unitPrice: number; libraryPrice: number | null; overrideReason?: string | null; kind?: LineKind | null }[],
): number[] {
  return lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !isPassThrough(l) && l.libraryPrice !== null && l.unitPrice !== l.libraryPrice && !(l.overrideReason ?? '').trim())
    .map(({ i }) => i);
}

export interface LibraryPrice {
  id: string;
  name: string;
  unit: string;
  unitPrice: number;
  active: boolean;
  kind?: LineKind;
  description?: string | null;
}

export interface SourceLine {
  libraryItemId: string | null;
  itemName: string;
  qty: number;
  section?: string | null;
  description?: string | null;
}

export interface CopiedLine {
  libraryItemId: string;
  itemName: string;
  unit: string;
  qty: number;
  unitPrice: number;
  libraryPrice: number;
  kind: LineKind;
  section: string | null;
  /** The source line's scope text when it had one, else the library default. */
  description: string | null;
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
    lines.push({
      libraryItemId: item.id,
      itemName: item.name,
      unit: item.unit,
      qty: s.qty,
      unitPrice: item.unitPrice,
      libraryPrice: item.unitPrice,
      kind: item.kind ?? 'service',
      section: s.section ?? null,
      description: (s.description ?? '').trim() || item.description || null,
    });
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
