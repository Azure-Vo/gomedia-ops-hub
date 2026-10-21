// Validation of CSV import rows (already split into objects). Shared by the web app preview
// and the Edge Function, so both apply the same rules.
import { parseLocalDateTime } from './time';

export type Row = Record<string, string | undefined>;

export interface RowError {
  row: number; // 1-based data row (header = row 0)
  message: string;
}

function pick(r: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** Whole-đồng amounts: "1.500.000", "1,500,000", "1500000 đ" → 1500000. */
export function parseVnd(input: string): number | null {
  const s = String(input ?? '').trim();
  if (!s || /[a-zA-Z]/.test(s.replace(/đ|vnd|VND|Đ/g, ''))) return null;
  const compact = s.replace(/\s|đ|Đ|vnd|VND/g, '');
  if (/^-?\d+[.,]\d{1,2}$/.test(compact)) return Math.round(Number(compact.replace(',', '.')));
  const digits = s.replace(/[^\d-]/g, '');
  if (!/^-?\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/** Decimal numbers typed in either Vietnamese ("7,5") or English ("7.5") style; "%" allowed. */
export function parseNumber(input: string): number | null {
  let s = String(input ?? '').trim().replace(/\s|%/g, '');
  if (!s) return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(decimal === ',' ? '.' : ',').join('').replace(',', '.');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

export interface LibraryImportRow {
  name: string;
  unit: string;
  serviceGroup: string;
  unitPrice: number;
  bandLow: number | null;
  bandHigh: number | null;
  code: string | null;
}

export function validateLibraryRows(rows: Row[]): { rows: LibraryImportRow[]; errors: RowError[] } {
  const out: LibraryImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const n = i + 1;
    const name = pick(r, 'item_name', 'name');
    const unit = pick(r, 'unit');
    const serviceGroup = pick(r, 'group', 'service_group');
    const price = parseVnd(pick(r, 'unit_price'));
    const lowRaw = pick(r, 'band_low');
    const highRaw = pick(r, 'band_high');
    const bandLow = lowRaw ? parseVnd(lowRaw) : null;
    const bandHigh = highRaw ? parseVnd(highRaw) : null;
    const problems: string[] = [];
    if (!name) problems.push('thiếu tên hạng mục');
    if (!unit) problems.push('thiếu đơn vị');
    if (!serviceGroup) problems.push('thiếu nhóm dịch vụ');
    if (price === null || price < 0) problems.push('đơn giá không hợp lệ');
    if (lowRaw && bandLow === null) problems.push('band_low không hợp lệ');
    if (highRaw && bandHigh === null) problems.push('band_high không hợp lệ');
    if (bandLow !== null && bandHigh !== null && bandLow > bandHigh) problems.push('band_low lớn hơn band_high');
    if (price !== null && bandLow !== null && bandLow > price) problems.push('band_low lớn hơn đơn giá');
    if (price !== null && bandHigh !== null && bandHigh < price) problems.push('band_high nhỏ hơn đơn giá');
    const key = `${name.toLowerCase()}|${unit.toLowerCase()}`;
    if (name && seen.has(key)) problems.push('trùng hạng mục (cùng tên và đơn vị) trong file');
    seen.add(key);
    if (problems.length) errors.push({ row: n, message: problems.join('; ') });
    else out.push({ name, unit, serviceGroup, unitPrice: price as number, bandLow, bandHigh, code: pick(r, 'code', 'item_code') || null });
  });
  return { rows: out, errors };
}

export interface HistoricalQuote {
  code: string;
  client: string;
  serviceGroup: string;
  requestedAt: number;
  sentAt: number;
  discountPct: number;
  lines: { itemName: string; unit: string; qty: number; unitPrice: number }[];
}

/** One CSV row per quote line: quote_code, client_alias, service_group, requested_at, sent_at, item_name, unit, qty, unit_price, discount_pct. */
export function validateQuoteHistoryRows(rows: Row[], timeZone: string): { quotes: HistoricalQuote[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const groups = new Map<string, { first: number; quote: HistoricalQuote }>();
  rows.forEach((r, i) => {
    const n = i + 1;
    const code = pick(r, 'quote_code', 'code');
    const client = pick(r, 'client_alias', 'client');
    const serviceGroup = pick(r, 'service_group', 'group');
    const reqRaw = pick(r, 'requested_at');
    const sentRaw = pick(r, 'sent_at');
    const requestedAt = parseLocalDateTime(reqRaw, timeZone);
    const sentAt = parseLocalDateTime(sentRaw, timeZone);
    const itemName = pick(r, 'item_name', 'name');
    const unit = pick(r, 'unit');
    const qty = parseNumber(pick(r, 'qty', 'quantity'));
    const unitPrice = parseVnd(pick(r, 'unit_price'));
    const discRaw = pick(r, 'discount_pct', 'discount');
    const discountPct = discRaw ? parseNumber(discRaw) : 0;
    const problems: string[] = [];
    if (!code) problems.push('thiếu quote_code');
    if (requestedAt === null) problems.push(`requested_at không đọc được ("${reqRaw}")`);
    if (sentAt === null) problems.push(`sent_at không đọc được ("${sentRaw}")`);
    if (requestedAt !== null && sentAt !== null && sentAt <= requestedAt) problems.push('sent_at phải sau requested_at');
    if (!itemName) problems.push('thiếu item_name');
    if (qty === null || qty <= 0) problems.push('qty phải lớn hơn 0');
    if (unitPrice === null || unitPrice < 0) problems.push('unit_price không hợp lệ');
    if (discountPct === null || discountPct < 0 || discountPct > 100) problems.push('discount_pct phải từ 0 đến 100');
    if (problems.length) {
      errors.push({ row: n, message: problems.join('; ') });
      return;
    }
    const existing = groups.get(code);
    const line = { itemName, unit: unit || '', qty: qty as number, unitPrice: unitPrice as number };
    if (!existing) {
      groups.set(code, {
        first: n,
        quote: { code, client, serviceGroup, requestedAt: requestedAt as number, sentAt: sentAt as number, discountPct: discountPct as number, lines: [line] },
      });
      return;
    }
    const q = existing.quote;
    if (q.requestedAt !== requestedAt || q.sentAt !== sentAt || q.discountPct !== discountPct || q.client !== client) {
      errors.push({ row: n, message: `các cột requested_at, sent_at, discount_pct, client_alias phải giống dòng ${existing.first} của cùng ${code}` });
      return;
    }
    q.lines.push(line);
  });
  return { quotes: [...groups.values()].map((g) => g.quote), errors };
}

export interface TaskImportRow {
  row: number; // 1-based data row in the file
  name: string;
  owner: string; // email or alias as typed
  taskType: string;
  startAt: number;
  dueAt: number;
  milestones: string[] | null;
  priorityNote: string | null;
}

/** task_name, owner_email (or owner_alias), task_type, start_at, due_at [, milestone_1..4, priority_note]. */
export function validateTaskRows(rows: Row[], timeZone: string): { rows: TaskImportRow[]; errors: RowError[] } {
  const out: TaskImportRow[] = [];
  const errors: RowError[] = [];
  rows.forEach((r, i) => {
    const n = i + 1;
    const name = pick(r, 'task_name', 'name');
    const owner = pick(r, 'owner_email', 'owner_alias', 'owner');
    const taskType = pick(r, 'task_type', 'type');
    const startRaw = pick(r, 'start_at');
    const dueRaw = pick(r, 'due_at');
    const startAt = parseLocalDateTime(startRaw, timeZone);
    const dueAt = parseLocalDateTime(dueRaw, timeZone);
    const ms = [1, 2, 3, 4].map((k) => pick(r, `milestone_${k}`));
    const problems: string[] = [];
    if (!name) problems.push('thiếu task_name');
    if (!owner) problems.push('thiếu owner_email');
    if (startAt === null) problems.push(`start_at không đọc được ("${startRaw}")`);
    if (dueAt === null) problems.push(`due_at không đọc được ("${dueRaw}")`);
    if (startAt !== null && dueAt !== null && dueAt <= startAt) problems.push('due_at phải sau start_at');
    const someMs = ms.some(Boolean);
    if (someMs && !ms.every(Boolean)) problems.push('nếu ghi mốc thì phải đủ milestone_1 đến milestone_4');
    if (!someMs && !taskType) problems.push('cần task_type hoặc đủ 4 mốc');
    if (problems.length) errors.push({ row: n, message: problems.join('; ') });
    else out.push({ row: n, name, owner, taskType, startAt: startAt as number, dueAt: dueAt as number, milestones: someMs ? ms : null, priorityNote: pick(r, 'priority_note') || null });
  });
  return { rows: out, errors };
}
