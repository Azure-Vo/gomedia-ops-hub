import { describe, expect, it } from 'vitest';
import { approverFor, needsSignature, nextQuoteStatus, outcomeErrors, quoteLinkErrors, winRate } from './quote';

describe('1.7 · loại báo giá, CEO ký, kết quả khách', () => {
  it('quick in band goes out with the printed signature; everything else waits for the CEO', () => {
    expect(needsSignature('quick', 'send_now')).toBe(false);
    expect(needsSignature('quick', 'pm')).toBe(true);
    expect(needsSignature('project', 'send_now')).toBe(true);
    expect(approverFor('quick', 'send_now')).toBeNull();
    expect(approverFor('quick', 'pm')).toBe('pm');
    expect(approverFor('project', 'send_now')).toBe('ceo');
  });
  it('project quotes are always reviewed and signed', () => {
    expect(nextQuoteStatus('draft', 'submit', 'send_now', 'project')).toEqual({ ok: true, status: 'pending' });
    expect(nextQuoteStatus('draft', 'send', 'send_now', 'project').ok).toBe(false);
    expect(nextQuoteStatus('pending', 'approve')).toEqual({ ok: true, status: 'signing' });
    expect(nextQuoteStatus('signing', 'send').ok).toBe(false);
    expect(nextQuoteStatus('signing', 'request_changes')).toEqual({ ok: true, status: 'changes_requested' });
    expect(nextQuoteStatus('signing', 'edit')).toEqual({ ok: true, status: 'draft' });
    expect(nextQuoteStatus('approved', 'sign').ok).toBe(false);
  });
  it('checks who records the client answer and what it needs', () => {
    const q = { status: 'sent' as const, source: 'app' as const, createdBy: 'acc', hasProject: false };
    expect(outcomeErrors(q, { id: 'acc', role: 'account' }, { outcome: 'won', handoverPm: 'pm1' })).toEqual([]);
    expect(outcomeErrors(q, { id: 'x', role: 'account' }, { outcome: 'won', handoverPm: 'pm1' })[0]).toMatch(/Chỉ Account/);
    expect(outcomeErrors(q, { id: 'pm1', role: 'pm' }, { outcome: 'won' })).toEqual(['Chọn PM nhận dự án.']);
    expect(outcomeErrors(q, { id: 'acc', role: 'account' }, { outcome: 'lost', lostReason: 'nope' })).toEqual(['Chọn lý do không chốt.']);
    expect(outcomeErrors({ ...q, hasProject: true }, { id: 'acc', role: 'account' }, { outcome: null })[0]).toMatch(/đã có dự án/);
    expect(outcomeErrors({ ...q, status: 'approved' }, { id: 'acc', role: 'account' }, { outcome: 'lost', lostReason: 'price' })[0]).toMatch(/đã gửi/);
  });
  it('computes the win rate on answered quotes only', () => {
    expect(winRate([{ outcome: 'won' }, { outcome: 'lost' }, { outcome: null }, { outcome: 'won' }])).toEqual({ won: 2, lost: 1, pct: 66.7 });
    expect(winRate([{ outcome: null }]).pct).toBeNull();
  });
  it('lets only the receiving PM attach a won quote, once', () => {
    const q = { outcome: 'won' as const, source: 'app' as const, handoverPm: 'pm1', linked: false };
    expect(quoteLinkErrors(q, { id: 'pm1', role: 'pm' })).toEqual([]);
    expect(quoteLinkErrors(q, { id: 'pm2', role: 'pm' })).toEqual(['Báo giá này giao cho PM khác.']);
    expect(quoteLinkErrors({ ...q, linked: true }, { id: 'pm1', role: 'pm' })).toEqual(['Báo giá này đã thuộc một dự án.']);
    expect(quoteLinkErrors({ ...q, outcome: null }, { id: 'pm1', role: 'pm' })[0]).toMatch(/đã chốt/);
    expect(quoteLinkErrors(q, { id: 'acc', role: 'account' })[0]).toMatch(/Chỉ PM/);
  });
});
