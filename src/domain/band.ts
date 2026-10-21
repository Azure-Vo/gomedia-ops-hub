// Price-band check: decides whether a quote can be sent at once, needs the PM, or needs the CEO.

export type BandLevel = 'send_now' | 'pm' | 'ceo';
export const BAND_LEVELS: BandLevel[] = ['send_now', 'pm', 'ceo'];

export interface BandRule {
  level: BandLevel;
  /** Highest discount allowed at this level, in %; null = no limit. */
  maxDiscountPct: number | null;
  /** Largest |unit price − library price| / library price allowed, in %; null = no limit. */
  maxDeviationPct: number | null;
  /** Quote total must reach this % of its value at library prices; null = off. CEO-only setting. */
  marginFloorPct: number | null;
}

/** Placeholder rules until the CEO decides (see PRD). */
export const DEFAULT_BAND_RULES: BandRule[] = [
  { level: 'send_now', maxDiscountPct: 10, maxDeviationPct: 10, marginFloorPct: null },
  { level: 'pm', maxDiscountPct: 20, maxDeviationPct: 20, marginFloorPct: null },
  { level: 'ceo', maxDiscountPct: null, maxDeviationPct: null, marginFloorPct: null },
];

export interface BandLine {
  name?: string;
  qty: number;
  unitPrice: number;
  /** Current library price of the item; null when the line has no library item. */
  libraryPrice: number | null;
  /** Optional per-item self-send range (only used for the send_now level). */
  bandLow?: number | null;
  bandHigh?: number | null;
}

export type BandReason =
  | { code: 'discount'; level: BandLevel; value: number; limit: number }
  | {
      code: 'deviation';
      level: BandLevel;
      line: number;
      name?: string;
      value: number;
      limit: number | null;
      bandLow?: number | null;
      bandHigh?: number | null;
    }
  | { code: 'no_library_price'; level: BandLevel; line: number; name?: string }
  | { code: 'margin_floor'; level: BandLevel; value: number; limit: number };

export interface BandResult {
  level: BandLevel;
  discountPct: number;
  /** Largest absolute deviation from the library across lines, in %. */
  maxDeviationPct: number;
  /** Signed deviation per line in %, null when the line has no library price. */
  lineDeviationPct: (number | null)[];
  /** Quote total as % of the same lines at library prices; null if not computable. */
  effectivePct: number | null;
  /** Why each lower level was not reached. */
  failed: Partial<Record<BandLevel, BandReason[]>>;
  /** Reasons the quote left the self-send band (empty when level is send_now). */
  reasons: BandReason[];
}

const EPS = 1e-9;

export function deviationPct(unitPrice: number, libraryPrice: number | null | undefined): number | null {
  if (libraryPrice === null || libraryPrice === undefined || !(libraryPrice > 0)) return null;
  return ((unitPrice - libraryPrice) * 100) / libraryPrice;
}

export function ruleFor(level: BandLevel, rules: BandRule[]): BandRule {
  return rules.find((r) => r.level === level) ?? DEFAULT_BAND_RULES.find((r) => r.level === level)!;
}

function failuresAt(
  rule: BandRule,
  lines: BandLine[],
  discountPct: number,
  devs: (number | null)[],
  effectivePct: number | null,
): BandReason[] {
  const out: BandReason[] = [];
  const level = rule.level;
  if (rule.maxDiscountPct !== null && discountPct > rule.maxDiscountPct + EPS) {
    out.push({ code: 'discount', level, value: discountPct, limit: rule.maxDiscountPct });
  }
  lines.forEach((line, i) => {
    const dev = devs[i];
    if (dev === null) {
      out.push({ code: 'no_library_price', level, line: i, name: line.name });
      return;
    }
    const hasItemBand = (line.bandLow ?? null) !== null || (line.bandHigh ?? null) !== null;
    if (level === 'send_now' && hasItemBand) {
      const lo = line.bandLow ?? -Infinity;
      const hi = line.bandHigh ?? Infinity;
      if (line.unitPrice < lo || line.unitPrice > hi) {
        out.push({ code: 'deviation', level, line: i, name: line.name, value: dev, limit: null, bandLow: line.bandLow ?? null, bandHigh: line.bandHigh ?? null });
      }
      return;
    }
    if (rule.maxDeviationPct !== null && Math.abs(dev) > rule.maxDeviationPct + EPS) {
      out.push({ code: 'deviation', level, line: i, name: line.name, value: dev, limit: rule.maxDeviationPct });
    }
  });
  if (rule.marginFloorPct !== null && effectivePct !== null && effectivePct + EPS < rule.marginFloorPct) {
    out.push({ code: 'margin_floor', level, value: effectivePct, limit: rule.marginFloorPct });
  }
  return out;
}

/**
 * bandCheck(lines, discount, rules) → send_now | pm | ceo.
 * Default rules: send now if discount ≤ 10% and every unit price within ±10% of the library;
 * PM if discount ≤ 20% and deviation ≤ 20%; otherwise CEO.
 */
export function bandCheck(lines: BandLine[], discountPct: number, rules: BandRule[] = DEFAULT_BAND_RULES): BandResult {
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    throw new Error('Discount must be between 0 and 100%');
  }
  for (const l of lines) {
    if (!Number.isFinite(l.qty) || l.qty <= 0) throw new Error('Quantity must be greater than 0');
    if (!Number.isFinite(l.unitPrice) || l.unitPrice < 0) throw new Error('Unit price must be 0 or more');
  }
  const devs = lines.map((l) => deviationPct(l.unitPrice, l.libraryPrice));
  const known = devs.filter((d): d is number => d !== null).map((d) => Math.abs(d));
  const maxDeviationPct = known.length ? Math.max(...known) : 0;

  let effectivePct: number | null = null;
  if (lines.length && devs.every((d) => d !== null)) {
    const libraryValue = lines.reduce((s, l) => s + l.qty * (l.libraryPrice as number), 0);
    const quoted = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * (1 - discountPct / 100);
    effectivePct = libraryValue > 0 ? (quoted * 100) / libraryValue : null;
  }

  const failed: Partial<Record<BandLevel, BandReason[]>> = {};
  let level: BandLevel = 'ceo';
  for (const candidate of ['send_now', 'pm'] as BandLevel[]) {
    const f = failuresAt(ruleFor(candidate, rules), lines, discountPct, devs, effectivePct);
    if (!f.length) {
      level = candidate;
      break;
    }
    failed[candidate] = f;
  }
  return {
    level,
    discountPct,
    maxDeviationPct,
    lineDeviationPct: devs,
    effectivePct,
    failed,
    reasons: level === 'send_now' ? [] : failed[level === 'pm' ? 'send_now' : 'pm'] ?? [],
  };
}

/** What an Account may see: the result and which lines/discount caused it, never the limits. */
export interface PublicBandReason {
  code: BandReason['code'];
  line?: number;
  name?: string;
  value?: number;
}

export interface PublicBand {
  level: BandLevel;
  discountPct: number;
  maxDeviationPct: number;
  lineDeviationPct: (number | null)[];
  reasons: PublicBandReason[];
}

export function publicBand(result: BandResult): PublicBand {
  return {
    level: result.level,
    discountPct: result.discountPct,
    maxDeviationPct: result.maxDeviationPct,
    lineDeviationPct: result.lineDeviationPct,
    reasons: result.reasons.map((r) => {
      if (r.code === 'discount') return { code: r.code, value: r.value };
      if (r.code === 'deviation') return { code: r.code, line: r.line, name: r.name, value: r.value };
      if (r.code === 'no_library_price') return { code: r.code, line: r.line, name: r.name };
      return { code: r.code };
    }),
  };
}

export const BAND_LABEL: Record<BandLevel, string> = {
  send_now: 'Gửi ngay',
  pm: 'Cần PM duyệt',
  ceo: 'Cần CEO duyệt',
};

function pct(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('vi-VN')}%`;
}

/** One Vietnamese sentence per reason, without revealing limits. */
export function describeReason(r: PublicBandReason): string {
  switch (r.code) {
    case 'discount':
      return `Chiết khấu ${(r.value ?? 0).toLocaleString('vi-VN')}% vượt mức được phép ở cấp này`;
    case 'deviation':
      return `Đơn giá "${r.name ?? `dòng ${(r.line ?? 0) + 1}`}" lệch ${pct(r.value ?? 0)} so với thư viện`;
    case 'no_library_price':
      return `Dòng "${r.name ?? `dòng ${(r.line ?? 0) + 1}`}" không có giá thư viện để so sánh`;
    case 'margin_floor':
      return 'Tổng giá thấp hơn mức sàn của công ty';
  }
}
