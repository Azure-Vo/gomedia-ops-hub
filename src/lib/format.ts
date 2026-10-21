// Display helpers built on the domain formatters (one format everywhere).
import { fmtNum, fmtVnd, fmtVnDate, fmtVnDateTime, fmtVnLong, fmtVnShort, localToMs, pad2, toLocalParts } from '@/domain';

export { fmtNum, fmtVnd, fmtVnDate, fmtVnDateTime, fmtVnLong, fmtVnShort };

/** Value for <input type="datetime-local"> showing the instant in the company time zone. */
export function toLocalInput(t: string | number | null | undefined, tz: string): string {
  if (t === null || t === undefined || t === '') return '';
  const p = toLocalParts(t, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Reads <input type="datetime-local"> as company-time-zone wall time (not the laptop's zone). */
export function fromLocalInput(v: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return localToMs(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

export function toDateInput(t: string | number | null | undefined, tz: string): string {
  if (t === null || t === undefined || t === '') return '';
  const p = toLocalParts(t, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function fmtHours(h: number | null | undefined): string {
  return h === null || h === undefined ? '–' : `${fmtNum(h, 2)} giờ`;
}

export function fmtPct(p: number | null | undefined, digits = 1): string {
  return p === null || p === undefined ? '–' : `${fmtNum(p, digits)}%`;
}

export function timeAgo(t: string | number, now = Date.now()): string {
  const diff = Math.max(0, now - (typeof t === 'number' ? t : Date.parse(t)));
  const m = Math.round(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}
