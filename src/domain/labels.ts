// Vietnamese labels and date formats shared by the web app and the bot messages.
import { toLocalParts } from './time';

export type Role = 'account' | 'pm' | 'ceo' | 'ecom_exec' | 'staff' | 'admin';

export const ROLE_LABEL: Record<Role, string> = {
  account: 'Account',
  pm: 'PM',
  ceo: 'CEO',
  ecom_exec: 'E-commerce Executive',
  staff: 'Nhân viên',
  admin: 'Admin',
};

const VN_WEEKDAY = ['', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

function p2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "T6 17:30, 09/10" */
export function fmtVnShort(t: number | string | Date, timeZone: string): string {
  const p = toLocalParts(t, timeZone);
  return `${VN_WEEKDAY[p.weekday]} ${p2(p.hour)}:${p2(p.minute)}, ${p2(p.day)}/${p2(p.month)}`;
}

const VN_WEEKDAY_LONG = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

/** "Thứ Tư 21/10/2026 10:26" — echoes a date field in Vietnamese order (native pickers follow the browser language). */
export function fmtVnLong(t: number | string | Date, timeZone: string): string {
  const p = toLocalParts(t, timeZone);
  return `${VN_WEEKDAY_LONG[p.weekday]} ${p2(p.day)}/${p2(p.month)}/${p.year} ${p2(p.hour)}:${p2(p.minute)}`;
}

/** "09/10/2026 17:30" */
export function fmtVnDateTime(t: number | string | Date, timeZone: string): string {
  const p = toLocalParts(t, timeZone);
  return `${p2(p.day)}/${p2(p.month)}/${p.year} ${p2(p.hour)}:${p2(p.minute)}`;
}

/** "09/10/2026" */
export function fmtVnDate(t: number | string | Date, timeZone: string): string {
  const p = toLocalParts(t, timeZone);
  return `${p2(p.day)}/${p2(p.month)}/${p.year}`;
}

/** 27360000 → "27.360.000 đ" */
export function fmtVnd(n: number | null | undefined, withUnit = true): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '−' : ''}${s}${withUnit ? ' đ' : ''}`;
}

/** 8.657 → "8,66" */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return n.toFixed(digits).replace('.', ',');
}
