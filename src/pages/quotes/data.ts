import type { BandLevel, LineKind, PublicBand, QuoteStatus } from '@/domain';
import { check, supabase } from '@/lib/supabase';

export interface LibraryItem {
  id: string;
  code: string | null;
  name: string;
  unit: string;
  service_group: string;
  unit_price: number;
  band_low: number | null;
  band_high: number | null;
  last_reviewed_at: string;
  active: boolean;
  kind: LineKind;
  description: string | null;
  updated_at?: string;
}

export interface QuoteTerm {
  id: string;
  text: string;
  default_on: boolean;
  position: number;
  active: boolean;
}

export interface QuoteRow {
  id: string;
  code: string;
  client: string;
  service_group: string | null;
  requested_at: string;
  sent_at: string | null;
  status: QuoteStatus;
  discount_pct: number;
  subtotal: number;
  total: number;
  contact: string;
  project: string;
  venue: string;
  vat_pct: number;
  vat_amount: number;
  grand_total: number;
  terms: string[];
  band_result: BandLevel | null;
  band_detail: PublicBand | null;
  approver: 'pm' | 'ceo' | null;
  approval_requested_at: string | null;
  source: 'app' | 'import';
  copied_from: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LineRow {
  id: string;
  quote_id: string;
  position: number;
  library_item_id: string | null;
  item_name: string;
  unit: string;
  qty: number;
  unit_price: number;
  library_price: number | null;
  override_reason: string | null;
  section: string;
  description: string | null;
  kind: LineKind;
}

export interface ApprovalRow {
  id: string;
  level: 'pm' | 'ceo';
  approver_id: string;
  decision: 'approve' | 'changes';
  comment: string | null;
  decided_at: string;
}

export const QUOTE_COLS =
  'id, code, client, service_group, requested_at, sent_at, status, discount_pct, subtotal, total, contact, project, venue, vat_pct, vat_amount, grand_total, terms, band_result, band_detail, approver, approval_requested_at, source, copied_from, created_by, created_at, updated_at';
export const LINE_COLS = 'id, quote_id, position, library_item_id, item_name, unit, qty, unit_price, library_price, override_reason, section, description, kind';
export const LIB_COLS = 'id, code, name, unit, service_group, unit_price, band_low, band_high, last_reviewed_at, active, kind, description, updated_at';

export function normQuote(q: QuoteRow): QuoteRow {
  return {
    ...q,
    discount_pct: Number(q.discount_pct),
    subtotal: Number(q.subtotal),
    total: Number(q.total),
    contact: q.contact ?? '',
    project: q.project ?? '',
    venue: q.venue ?? '',
    vat_pct: Number(q.vat_pct ?? 0),
    vat_amount: Number(q.vat_amount ?? 0),
    grand_total: Number(q.grand_total ?? 0),
    terms: Array.isArray(q.terms) ? q.terms.map(String) : [],
  };
}

export function normLine(l: LineRow): LineRow {
  return { ...l, qty: Number(l.qty), unit_price: Number(l.unit_price), library_price: l.library_price === null ? null : Number(l.library_price), section: l.section ?? '', kind: l.kind ?? 'service' };
}

export function normLib(i: LibraryItem): LibraryItem {
  return { ...i, kind: i.kind ?? 'service', unit_price: Number(i.unit_price), band_low: i.band_low === null ? null : Number(i.band_low), band_high: i.band_high === null ? null : Number(i.band_high) };
}

export async function loadLibrary(includeRetired = false): Promise<LibraryItem[]> {
  let q = supabase.from('library_items').select(LIB_COLS).order('service_group').order('name');
  if (!includeRetired) q = q.eq('active', true);
  return (check(await q) as LibraryItem[]).map(normLib);
}

export async function loadTerms(includeRetired = false): Promise<QuoteTerm[]> {
  let q = supabase.from('quote_terms').select('id, text, default_on, position, active').order('position').order('text');
  if (!includeRetired) q = q.eq('active', true);
  return check(await q) as QuoteTerm[];
}

/** What the client pays: quotes made before VAT existed (grand_total 0) fall back to their total. */
export function payable(q: { total: number; grand_total?: number | null }): number {
  return Number(q.grand_total) > 0 ? Number(q.grand_total) : Number(q.total);
}

export async function loadPeople(): Promise<Map<string, { full_name: string; email: string; role: string }>> {
  const rows = check(await supabase.from('profiles').select('id, full_name, email, role')) as { id: string; full_name: string; email: string; role: string }[];
  return new Map(rows.map((r) => [r.id, r]));
}

export function personName(people: Map<string, { full_name: string; email: string }>, id: string | null | undefined): string {
  if (!id) return '–';
  const p = people.get(id);
  return p ? p.full_name || p.email : '–';
}
