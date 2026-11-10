import { describe, expect, it } from 'vitest';
import { anchorLabel, approveGate, buildThreads, canComment, changesSummary, openThreadCount, requestChangesGate, ReviewComment, sendGate, threadPlacement, validateCommentBody } from './review';

const c = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'a',
  parentId: null,
  authorId: 'pm',
  anchor: 'general',
  lineId: null,
  sectionTitle: null,
  anchorLabel: '',
  body: 'x',
  resolvedAt: null,
  resolvedBy: null,
  createdAt: '2026-11-10T02:00:00Z',
  ...over,
});

describe('review comments on a quote', () => {
  it('lets the PM, the CEO and the owning Account comment until the quote is sent', () => {
    expect(canComment('pm', false, 'pending')).toBe(true);
    expect(canComment('ceo', false, 'draft')).toBe(true);
    expect(canComment('account', true, 'changes_requested')).toBe(true);
    expect(canComment('account', false, 'pending')).toBe(false);
    expect(canComment('admin', false, 'pending')).toBe(false);
    expect(canComment('staff', false, 'pending')).toBe(false);
    expect(canComment('pm', false, 'sent')).toBe(false);
    expect(canComment('account', true, 'sent')).toBe(false);
  });

  it('labels the place a comment points at', () => {
    expect(anchorLabel({ anchor: 'line', position: 3, itemName: 'Video TikTok ngắn' })).toBe('Dòng 3 · Video TikTok ngắn');
    expect(anchorLabel({ anchor: 'section', sectionTitle: 'Quảng cáo' })).toBe('Phần · Quảng cáo');
    expect(anchorLabel({ anchor: 'totals' })).toBe('Chiết khấu, thuế và tổng tiền');
  });

  it('rejects empty and over-long comments and trims the rest', () => {
    expect(validateCommentBody('   ')).toEqual({ ok: false, error: 'Hãy viết nội dung góp ý.' });
    expect(validateCommentBody(undefined).ok).toBe(false);
    expect(validateCommentBody('x'.repeat(2001)).ok).toBe(false);
    expect(validateCommentBody('  Giá này thấp quá  ')).toEqual({ ok: true, body: 'Giá này thấp quá' });
  });

  it('groups replies under their root, oldest first, and counts open threads', () => {
    const list = [
      c({ id: 'r2', parentId: 't1', createdAt: '2026-11-10T04:00:00Z' }),
      c({ id: 't2', createdAt: '2026-11-10T03:00:00Z', resolvedAt: '2026-11-10T05:00:00Z' }),
      c({ id: 't1', createdAt: '2026-11-10T02:00:00Z' }),
      c({ id: 'r1', parentId: 't1', createdAt: '2026-11-10T02:30:00Z' }),
      c({ id: 'lost', parentId: 'gone' }),
    ];
    const threads = buildThreads(list);
    expect(threads.map((t) => t.root.id)).toEqual(['t1', 't2']);
    expect(threads[0].replies.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(threads.map((t) => t.open)).toEqual([true, false]);
    expect(openThreadCount(list)).toBe(1);
  });

  it('keeps a comment visible after its line is deleted or its section renamed', () => {
    const existing = { lineIds: new Set(['L1']), sectionTitles: new Set(['Social']) };
    expect(threadPlacement(c({ anchor: 'line', lineId: 'L1' }), existing)).toBe('line');
    expect(threadPlacement(c({ anchor: 'line', lineId: null }), existing)).toBe('general');
    expect(threadPlacement(c({ anchor: 'line', lineId: 'L9' }), existing)).toBe('general');
    expect(threadPlacement(c({ anchor: 'section', sectionTitle: 'Social' }), existing)).toBe('section');
    expect(threadPlacement(c({ anchor: 'section', sectionTitle: 'Tên cũ' }), existing)).toBe('general');
    expect(threadPlacement(c({ anchor: 'terms' }), existing)).toBe('terms');
  });

  it('blocks approving and sending while a comment is open', () => {
    expect(approveGate(0)).toEqual({ ok: true });
    expect(approveGate(2).ok).toBe(false);
    expect(sendGate(0)).toEqual({ ok: true });
    expect(sendGate(1).ok).toBe(false);
  });

  it('asks for a note or at least one open comment when requesting changes', () => {
    expect(requestChangesGate('', 0).ok).toBe(false);
    expect(requestChangesGate('  ', 0).ok).toBe(false);
    expect(requestChangesGate('Giảm chiết khấu', 0)).toEqual({ ok: true });
    expect(requestChangesGate('', 3)).toEqual({ ok: true });
    expect(changesSummary('', 3)).toBe('3 góp ý trên báo giá');
    expect(changesSummary(' Giảm chiết khấu ', 3)).toBe('Giảm chiết khấu');
  });
});
