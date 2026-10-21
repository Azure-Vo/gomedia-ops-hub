// Time-zone helpers. Pure: only the built-in Intl API, no React, no database.
// Every instant is a UTC epoch in milliseconds; "local" means wall time in the
// calendar's time zone (Asia/Ho_Chi_Minh by default).

export type Instant = Date | string | number;

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // ISO: 1 = Monday ... 7 = Sunday
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Converts any accepted instant to epoch milliseconds; throws on an invalid value. */
export function toMs(t: Instant): number {
  const ms = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t);
  if (!Number.isFinite(ms)) throw new Error(`Invalid date: ${String(t)}`);
  return ms;
}

export function toLocalParts(t: Instant, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(new Date(toMs(t)));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

/** Minutes the zone is ahead of UTC at instant t (Vietnam: +420). */
export function offsetMinutes(t: number, timeZone: string): number {
  const whole = Math.floor(t / 1000) * 1000;
  const p = toLocalParts(whole, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - whole) / 60000);
}

/** The instant at which the wall clock in `timeZone` shows the given local time. */
export function localToMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMinutes(guess, timeZone) * 60000;
  const second = offsetMinutes(first, timeZone);
  return guess - second * 60000;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar date of an instant, as YYYY-MM-DD. */
export function localDateKey(t: Instant, timeZone: string): string {
  const p = toLocalParts(t, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Adds whole days to a Y-M-D date without touching time zones. */
export function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** ISO weekday (1 = Monday) of a Y-M-D date. */
export function isoWeekday(year: number, month: number, day: number): number {
  const w = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Monday (YYYY-MM-DD, local) of the week that contains instant t. */
export function localWeekStart(t: Instant, timeZone: string): string {
  const p = toLocalParts(t, timeZone);
  const back = p.weekday - 1;
  const d = addDays(p.year, p.month, p.day, -back);
  return dateKey(d.year, d.month, d.day);
}

/**
 * Parses a local date-time typed by people or exported from Excel/Sheets.
 * Accepts "YYYY-MM-DD HH:MM[:SS]", "YYYY-MM-DDTHH:MM", "DD/MM/YYYY HH:MM[:SS]" and a full
 * ISO string with an explicit offset or Z (kept as is). Returns epoch ms or null.
 */
export function parseLocalDateTime(input: string, timeZone: string): number | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /\d{4}-\d{2}-\d{2}T/.test(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let y: number, mo: number, d: number, h = 0, mi = 0;
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] !== undefined) { h = +m[4]; mi = +m[5]; }
  } else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
    if (m[4] !== undefined) { h = +m[4]; mi = +m[5]; }
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  return localToMs(y, mo, d, h, mi, timeZone);
}
