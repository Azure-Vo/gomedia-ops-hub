// Working-time calendar. Every duration in the app is counted in WORKING hours.
import { addDays, dateKey, Instant, isoWeekday, localToMs, toLocalParts, toMs } from './time';

export interface WorkBlock {
  start: string; // "HH:MM" local
  end: string; // "HH:MM" local, after start
}

export interface WorkCalendar {
  timeZone: string;
  workDays: number[]; // ISO weekdays, 1 = Monday
  blocks: WorkBlock[];
  holidays: string[]; // local dates YYYY-MM-DD
}

/** Default to be confirmed with Go Media: Mon–Fri, 08:00–12:00 and 13:30–17:30. */
export const DEFAULT_CALENDAR: WorkCalendar = {
  timeZone: 'Asia/Ho_Chi_Minh',
  workDays: [1, 2, 3, 4, 5],
  blocks: [
    { start: '08:00', end: '12:00' },
    { start: '13:30', end: '17:30' },
  ],
  holidays: [],
};

const HOUR = 3_600_000;
const MAX_DAYS = 3700;

export function parseHM(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) throw new Error(`Invalid time "${value}"`);
  return h * 60 + mi;
}

/** Returns a list of problems in Vietnamese; empty means the calendar is usable. */
export function validateCalendar(cal: WorkCalendar): string[] {
  const errors: string[] = [];
  if (!cal.timeZone) errors.push('Thiếu múi giờ.');
  else {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: cal.timeZone });
    } catch {
      errors.push(`Múi giờ không hợp lệ: ${cal.timeZone}.`);
    }
  }
  if (!cal.workDays.length) errors.push('Cần ít nhất một ngày làm việc trong tuần.');
  if (cal.workDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) errors.push('Ngày làm việc phải từ 1 (thứ Hai) đến 7 (Chủ nhật).');
  if (!cal.blocks.length) errors.push('Cần ít nhất một ca làm việc.');
  let prevEnd = -1;
  const sorted = [...cal.blocks].sort((a, b) => safeHM(a.start) - safeHM(b.start));
  for (const b of sorted) {
    let s: number;
    let e: number;
    try {
      s = parseHM(b.start);
      e = parseHM(b.end);
    } catch {
      errors.push(`Ca ${b.start}–${b.end}: giờ không hợp lệ.`);
      continue;
    }
    if (e <= s) errors.push(`Ca ${b.start}–${b.end}: giờ kết thúc phải sau giờ bắt đầu.`);
    if (s < prevEnd) errors.push(`Ca ${b.start}–${b.end} chồng lên ca trước.`);
    prevEnd = Math.max(prevEnd, e);
  }
  for (const h of cal.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) errors.push(`Ngày lễ không hợp lệ: ${h} (định dạng YYYY-MM-DD).`);
  }
  return errors;
}

function safeHM(v: string): number {
  try {
    return parseHM(v);
  } catch {
    return 0;
  }
}

interface Prepared {
  tz: string;
  workDays: Set<number>;
  blocks: Array<[number, number]>; // minutes since local midnight
  holidays: Set<string>;
}

const preparedCache = new WeakMap<WorkCalendar, Prepared>();

function prepare(cal: WorkCalendar): Prepared {
  const cached = preparedCache.get(cal);
  if (cached) return cached;
  const errors = validateCalendar(cal);
  if (errors.length) throw new Error(`Invalid calendar: ${errors.join(' ')}`);
  const prepared: Prepared = {
    tz: cal.timeZone,
    workDays: new Set(cal.workDays),
    blocks: cal.blocks.map((b) => [parseHM(b.start), parseHM(b.end)] as [number, number]).sort((a, b) => a[0] - b[0]),
    holidays: new Set(cal.holidays),
  };
  preparedCache.set(cal, prepared);
  return prepared;
}

function dayIntervals(year: number, month: number, day: number, p: Prepared): Array<[number, number]> {
  if (!p.workDays.has(isoWeekday(year, month, day))) return [];
  if (p.holidays.has(dateKey(year, month, day))) return [];
  return p.blocks.map(([s, e]) => [
    localToMs(year, month, day, Math.floor(s / 60), s % 60, p.tz),
    localToMs(year, month, day, Math.floor(e / 60), e % 60, p.tz),
  ]);
}

/** Working milliseconds in [start, end). Zero when end is not after start. */
export function workingMsBetween(start: Instant, end: Instant, cal: WorkCalendar = DEFAULT_CALENDAR): number {
  const a = toMs(start);
  const b = toMs(end);
  if (!(b > a)) return 0;
  const p = prepare(cal);
  let { year, month, day } = toLocalParts(a, p.tz);
  let total = 0;
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [s, e] of dayIntervals(year, month, day, p)) {
      const lo = Math.max(s, a);
      const hi = Math.min(e, b);
      if (hi > lo) total += hi - lo;
    }
    const next = addDays(year, month, day, 1);
    if (localToMs(next.year, next.month, next.day, 0, 0, p.tz) >= b) break;
    ({ year, month, day } = next);
  }
  return total;
}

/** Working hours between two instants, e.g. Mon 16:30 → Tue 09:30 = 2.5. */
export function workingHoursBetween(start: Instant, end: Instant, cal: WorkCalendar = DEFAULT_CALENDAR): number {
  return workingMsBetween(start, end, cal) / HOUR;
}

/**
 * The instant reached after `ms` working milliseconds from `start`.
 * A start outside working time counts from the next working minute. When the
 * amount ends exactly at the end of a block (e.g. 12:00), that end is returned.
 */
export function addWorkingMs(start: Instant, ms: number, cal: WorkCalendar = DEFAULT_CALENDAR): number {
  if (!(ms >= 0)) throw new Error('Working time to add must be zero or more');
  const a = toMs(start);
  const p = prepare(cal);
  let remaining = ms;
  let { year, month, day } = toLocalParts(a, p.tz);
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [s, e] of dayIntervals(year, month, day, p)) {
      if (e <= a) continue;
      const from = Math.max(s, a);
      const available = e - from;
      if (remaining <= available) return from + remaining;
      remaining -= available;
    }
    ({ year, month, day } = addDays(year, month, day, 1));
  }
  throw new Error('No working time found in the calendar');
}

export function addWorkingHours(start: Instant, hours: number, cal: WorkCalendar = DEFAULT_CALENDAR): Date {
  return new Date(addWorkingMs(start, Math.round(hours * HOUR), cal));
}

/** True when t falls inside a working block (block edges count as inside). */
export function isWorkingTime(t: Instant, cal: WorkCalendar = DEFAULT_CALENDAR): boolean {
  const ms = toMs(t);
  const p = prepare(cal);
  const { year, month, day } = toLocalParts(ms, p.tz);
  return dayIntervals(year, month, day, p).some(([s, e]) => ms >= s && ms <= e);
}

/** t itself when it is working time, otherwise the start of the next working block. */
export function nextWorkingMinute(t: Instant, cal: WorkCalendar = DEFAULT_CALENDAR): Date {
  const ms = toMs(t);
  return new Date(isWorkingTime(ms, cal) ? ms : addWorkingMs(ms, 0, cal));
}

/** Working hours in a normal working day of this calendar (8 by default). */
export function hoursPerWorkingDay(cal: WorkCalendar = DEFAULT_CALENDAR): number {
  return cal.blocks.reduce((sum, b) => sum + (parseHM(b.end) - parseHM(b.start)) / 60, 0);
}
