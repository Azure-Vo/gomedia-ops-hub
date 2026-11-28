import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from './calendar';
import { accountJourneys, gradeOf, gradeScaleErrors, quoteJourney, teamStageShare } from './journey';
import { localToMs } from './time';

const tz = DEFAULT_CALENDAR.timeZone;
const at = (d: number, h: number, m = 0) => localToMs(2026, 11, d, h, m, tz); // 11/2026, Mon 2 = workday
const base = { client: 'K', accountId: 'a', accountName: 'A' };

describe('quoteJourney', () => {
  it('splits a quote into draft → review → fix → review → sign → send', () => {
    const r = quoteJourney(
      {
        ...base, id: '1', code: 'Q1', requestedAt: at(2, 8), sentAt: at(2, 16, 30),
        events: [
          { action: 'quote.submitted', at: at(2, 10) },
          { action: 'quote.changes_requested', at: at(2, 11) },
          { action: 'quote.submitted', at: at(2, 13, 30) },
          { action: 'quote.approved', at: at(2, 14, 30) },
          { action: 'quote.signed', at: at(2, 15, 30) },
        ],
      },
      DEFAULT_CALENDAR,
    );
    expect(r.rounds).toBe(1);
    expect(r.segments.map((s) => s.stage)).toEqual(['draft', 'review', 'fix', 'review', 'sign', 'send']);
    const sum = Object.values(r.stageHours).reduce((a, b) => a + (b ?? 0), 0);
    expect(sum).toBeCloseTo(r.kpiHours!, 6);
    expect(r.onTarget).toBe(true);
    expect(r.grade).toBe('good');
  });
  it('a quote sent straight away is all drafting; the client stage runs until the client signs', () => {
    const r = quoteJourney({ ...base, id: '2', code: 'Q2', requestedAt: at(3, 8), sentAt: at(3, 10), clientSignedAt: at(3, 15), events: [] }, DEFAULT_CALENDAR);
    expect(r.stageHours.draft).toBeCloseTo(2, 6);
    expect(r.stageHours.client).toBeGreaterThan(0);
    expect(r.kpiHours).toBeCloseTo(2, 6);
    expect(r.slowest).toBe('draft');
  });
  it('reopen after a change request counts as fixing', () => {
    const r = quoteJourney(
      { ...base, id: '3', code: 'Q3', requestedAt: at(4, 8), sentAt: null, events: [ { action: 'quote.submitted', at: at(4, 9) }, { action: 'quote.changes_requested', at: at(4, 10) }, { action: 'quote.reopened', at: at(4, 10, 5) }, { action: 'quote.submitted', at: at(4, 11) } ] },
      DEFAULT_CALENDAR,
    );
    expect(r.segments.map((s) => s.stage)).toEqual(['draft', 'review', 'fix']);
    expect(r.kpiHours).toBeNull();
  });
});

describe('grades and ranking', () => {
  it('grades by the scale', () => {
    expect([8, 8.5, 16, 20, 30].map((h) => gradeOf(h))).toEqual(['good', 'fair', 'fair', 'weak', 'poor']);
    expect(gradeScaleErrors({ good: 8, fair: 6, weak: 24 }).length).toBe(1);
    expect(gradeScaleErrors({ good: 8, fair: 16, weak: 24 })).toEqual([]);
  });
  it('ranks accounts by on-target share, then average hours', () => {
    const mk = (id: string, acc: string, h: number) => quoteJourney({ ...base, id, code: id, accountId: acc, accountName: acc, requestedAt: at(2, 8), sentAt: at(2, 8) + h * 3_600_000, events: [] }, DEFAULT_CALENDAR);
    // 2/11 08:00 + 4h = 12:00 (lunch not counted by the default calendar may shift; use small values).
    const rows = [mk('1', 'B', 2), mk('2', 'B', 3), mk('3', 'A', 1), mk('4', 'A', 1)];
    const acc = accountJourneys(rows);
    expect(acc.map((a) => a.accountName)).toEqual(['A', 'B']);
    expect(acc[0].onTargetPct).toBe(100);
    expect(teamStageShare(rows).find((s) => s.stage === 'draft')!.pct).toBeCloseTo(100, 6);
  });
});
