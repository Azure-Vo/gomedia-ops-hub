// The business-rule test table from the PRD. It runs in three places: Vitest, the admin
// Diagnostics page (in the browser) and the Edge Function (so a stale deployment shows up).
import { bandCheck, BandLine, DEFAULT_BAND_RULES } from './band';
import { DEFAULT_CALENDAR, WorkCalendar, workingHoursBetween } from './calendar';
import { quoteKpis, QuoteForKpi, round } from './kpi';
import { nextQuoteStatus, quoteTotals } from './quote';
import { answerEffect, checkpointTimes, closeOutcome, planDispatch } from './tasks';
import { localToMs, toLocalParts } from './time';

export interface CaseResult {
  id: number;
  rule: string;
  input: string;
  expected: string;
  actual: string;
  pass: boolean;
}

interface Case {
  id: number;
  rule: string;
  input: string;
  expected: string;
  run: () => string;
}

const TZ = DEFAULT_CALENDAR.timeZone;
const DAY: Record<string, number> = { Mon: 5, Tue: 6, Wed: 7, Thu: 8, Fri: 9, Sat: 10, Sun: 11, NextMon: 12 };

/** A local time in the fixed test week (Mon 5 – Fri 9 October 2026, no holidays). */
export function at(day: keyof typeof DAY, hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return localToMs(2026, 10, DAY[day], h, m, TZ);
}

const WD = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function fmtLocal(t: number | Date, timeZone = TZ): string {
  const p = toLocalParts(t, timeZone);
  return `${WD[p.weekday]} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function hours(v: number): string {
  return v.toFixed(1);
}

/** 27360000 → "27.360.000" (Vietnamese grouping) without relying on ICU locale data. */
export function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const lib = (n: number, price = 1_000_000, unitPrice = price): BandLine => ({ name: `Item ${n}`, qty: 1, unitPrice, libraryPrice: price });

function cases(cal: WorkCalendar): Case[] {
  return [
    {
      id: 1,
      rule: 'Giờ làm việc',
      input: 'Mon 16:30 → Tue 09:30',
      expected: '2.5',
      run: () => hours(workingHoursBetween(at('Mon', '16:30'), at('Tue', '09:30'), cal)),
    },
    {
      id: 2,
      rule: 'Giờ làm việc',
      input: 'Fri 11:00 → Mon 09:00 (qua cuối tuần)',
      expected: '6.0',
      run: () => hours(workingHoursBetween(at('Fri', '11:00'), at('NextMon', '09:00'), cal)),
    },
    {
      id: 3,
      rule: 'Giờ làm việc',
      input: 'Wed 11:00 → Wed 14:00 (qua giờ nghỉ trưa)',
      expected: '1.5',
      run: () => hours(workingHoursBetween(at('Wed', '11:00'), at('Wed', '14:00'), cal)),
    },
    {
      id: 4,
      rule: 'Khung giá',
      input: 'Chiết khấu 5%, mọi đơn giá đúng thư viện',
      expected: 'send_now',
      run: () => bandCheck([lib(1), lib(2), lib(3)], 5, DEFAULT_BAND_RULES).level,
    },
    {
      id: 5,
      rule: 'Khung giá',
      input: 'Chiết khấu 15%, mọi đơn giá đúng thư viện',
      expected: 'pm',
      run: () => bandCheck([lib(1), lib(2), lib(3)], 15, DEFAULT_BAND_RULES).level,
    },
    {
      id: 6,
      rule: 'Khung giá',
      input: 'Chiết khấu 5%, một đơn giá +25%',
      expected: 'ceo',
      run: () => bandCheck([lib(1), lib(2, 1_000_000, 1_250_000), lib(3)], 5, DEFAULT_BAND_RULES).level,
    },
    {
      id: 7,
      rule: 'Lịch checkpoint',
      input: 'Mon 08:00 → Fri 17:30 (40 giờ làm việc)',
      expected: 'Tue 10:00, Wed 12:00, Thu 15:30, Fri 17:06',
      run: () => checkpointTimes(at('Mon', '08:00'), at('Fri', '17:30'), cal).map((d) => fmtLocal(d)).join(', '),
    },
    {
      id: 8,
      rule: 'Trả lời checkpoint',
      input: 'Behind ở mốc 75% khi đã xong 2/4',
      expected: 'at_risk, 1 cảnh báo at_risk',
      run: () => {
        const e = answerEffect({ doneCount: 2, status: 'on_track' }, 3, 'behind');
        return `${e.status}, ${e.alert ? `1 cảnh báo ${e.alert.kind}` : '0 cảnh báo'}`;
      },
    },
    {
      id: 9,
      rule: 'Trả lời checkpoint',
      input: 'On plan ở mốc 99% khi đã xong 3/4',
      expected: 'done, 4/4',
      run: () => {
        const e = answerEffect({ doneCount: 3, status: 'on_track' }, 4, 'on_plan');
        return `${e.status}, ${e.doneCount}/4`;
      },
    },
    {
      id: 10,
      rule: 'KPI báo giá',
      input: '3 báo giá mất 6h, 8h, 12h làm việc',
      expected: 'TB 8.67h, 33.3% trễ',
      run: () => {
        const qs: QuoteForKpi[] = [
          { id: 'a', requestedAt: at('Mon', '08:00'), sentAt: at('Mon', '15:30') },
          { id: 'b', requestedAt: at('Mon', '08:00'), sentAt: at('Mon', '17:30') },
          { id: 'c', requestedAt: at('Mon', '08:00'), sentAt: at('Tue', '12:00') },
        ];
        const k = quoteKpis(qs, cal);
        return `TB ${(round(k.avgHours, 2) as number).toFixed(2)}h, ${(k.latePct as number).toFixed(1)}% trễ`;
      },
    },
    {
      id: 11,
      rule: 'Im lặng',
      input: 'Checkpoint gửi Mon 09:00, không trả lời đến Mon 11:00',
      expected: '1 cảnh báo no_reply',
      run: () => {
        const plan = planDispatch({
          now: at('Mon', '11:00'),
          cal,
          noReplyWindowHours: 2,
          tasks: [{ id: 't', status: 'on_track', dueAt: at('Fri', '17:30'), closedAs: null }],
          checkpoints: [{ id: 1, taskId: 't', pct: 25, scheduledAt: at('Mon', '09:00'), sentAt: at('Mon', '09:00'), answeredAt: null, expiredAt: null, noReplyAlertedAt: null }],
        });
        return `${plan.noReply.length} cảnh báo no_reply`;
      },
    },
    {
      id: 12,
      rule: 'Chốt task',
      input: 'Xong 4/4 mốc trước deadline',
      expected: 'on_time',
      run: () => closeOutcome([at('Tue', '10:00'), at('Wed', '12:00'), at('Thu', '15:30'), at('Fri', '17:06')], at('Fri', '17:30')),
    },
    {
      id: 13,
      rule: 'Tổng báo giá',
      input: '12 × 1.500.000 + 8 × 600.000 + 3 × 2.000.000, giảm 5%',
      expected: '27.360.000',
      run: () => {
        const lines = [
          { qty: 12, unitPrice: 1_500_000 },
          { qty: 8, unitPrice: 600_000 },
          { qty: 3, unitPrice: 2_000_000 },
        ];
        return groupThousands(quoteTotals(lines, 5).total);
      },
    },
    {
      id: 14,
      rule: 'Vòng đời báo giá',
      input: 'Sửa báo giá đã duyệt',
      expected: 'draft',
      run: () => {
        const t = nextQuoteStatus('approved', 'edit');
        return t.ok ? t.status : t.error;
      },
    },
    {
      id: 15,
      rule: 'Lịch checkpoint',
      input: 'Bắt đầu Sat 09:00 (ngoài giờ) → Mon 17:30',
      expected: 'Mon 10:00, Mon 12:00, Mon 15:30, Mon 17:25',
      run: () => checkpointTimes(at('Sat', '09:00'), at('NextMon', '17:30'), cal).map((d) => fmtLocal(d)).join(', '),
    },
  ];
}

/** Runs every rule case with the default calendar (the PRD's test conditions). */
export function runDomainCases(): CaseResult[] {
  const cal: WorkCalendar = { ...DEFAULT_CALENDAR, holidays: [] };
  return cases(cal).map((c) => {
    let actual: string;
    try {
      actual = c.run();
    } catch (err) {
      actual = `Lỗi: ${(err as Error).message}`;
    }
    return { id: c.id, rule: c.rule, input: c.input, expected: c.expected, actual, pass: actual === c.expected };
  });
}

/** PRD baseline: July–September 2026, 10 of 19 quotations over 8 working hours, average 8.66 h. */
export const BASELINE = { quotes: 19, avgHours: 8.66, latePct: 52.6, from: '2026-07-01', to: '2026-09-30' } as const;

/** A quote belongs to the baseline period by the local date the client request arrived. */
export function inBaselinePeriod(requestedAt: number, timeZone: string): boolean {
  const p = toLocalParts(requestedAt, timeZone);
  const d = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return d >= BASELINE.from && d <= BASELINE.to;
}

export interface BaselineCheck {
  ran: boolean;
  count: number;
  /** Imported quotes left out because their request date is outside the baseline period. */
  skipped: number;
  avgHours: number | null;
  latePct: number | null;
  pass: boolean;
  message: string;
}

/**
 * Case "the 19 baseline quotes → 8.66 h average, 52.6% late", on imported historical quotes whose
 * request date falls in the baseline period (older or newer history in the archive is left out).
 */
export function baselineCheck(quotes: QuoteForKpi[], cal: WorkCalendar, lateHours = 8): BaselineCheck {
  const inPeriod = quotes.filter((q) => inBaselinePeriod(q.requestedAt, cal.timeZone));
  const skipped = quotes.length - inPeriod.length;
  if (!inPeriod.length) {
    const message = quotes.length
      ? `Có ${quotes.length} báo giá lịch sử nhưng không báo giá nào có ngày khách yêu cầu trong kỳ baseline 01/07–30/09/2026.`
      : 'Chưa có báo giá lịch sử (nguồn import) để kiểm tra.';
    return { ran: false, count: 0, skipped, avgHours: null, latePct: null, pass: false, message };
  }
  const k = quoteKpis(inPeriod, cal, lateHours);
  const avg = round(k.avgHours, 2);
  const late = round(k.latePct, 1);
  const pass = k.count === BASELINE.quotes && avg === BASELINE.avgHours && late === BASELINE.latePct;
  const message = pass
    ? 'Khớp baseline nhóm tính tay.'
    : `Lệch baseline: app tính ${k.count} báo giá, TB ${avg}h, ${late}% trễ; nhóm tính 19 báo giá, 8.66h, 52.6%. Thống nhất cách tính (lịch giờ làm, ngày lễ, mốc thời gian, kỳ 01/07–30/09 theo ngày khách yêu cầu) trước khi pilot.`;
  return { ran: true, count: k.count, skipped, avgHours: avg, latePct: late, pass, message };
}
