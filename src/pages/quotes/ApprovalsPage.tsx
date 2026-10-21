import { useState } from 'react';
import { Link } from 'react-router-dom';
import { deviationPct, fmtNum, ROLE_LABEL, workingHoursBetween } from '@/domain';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Textarea, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnd, fmtVnDateTime } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { LINE_COLS, LineRow, loadLibrary, loadPeople, normLine, normQuote, personName, QUOTE_COLS, QuoteRow } from './data';
import { BandReasons, PriceTag } from './parts';

export function ApprovalsPage() {
  const me = useProfile();
  const { calendar, tz } = useSettings();
  const toast = useToast();
  const [decision, setDecision] = useState<{ quote: QuoteRow; kind: 'approve' | 'changes'; comment: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const level = me.role === 'ceo' ? 'ceo' : 'pm';
  const { data, error, loading, reload } = useAsync(async () => {
    const qs = (check(await supabase.from('quotes').select(QUOTE_COLS).eq('status', 'pending').eq('approver', level).order('approval_requested_at')) as QuoteRow[]).map(normQuote);
    const ids = qs.map((q) => q.id);
    const [lines, people, lib] = await Promise.all([
      ids.length ? supabase.from('quote_lines').select(LINE_COLS).in('quote_id', ids).order('position') : Promise.resolve({ data: [], error: null }),
      loadPeople(),
      loadLibrary(true),
    ]);
    return { qs, lines: (check(lines) as LineRow[]).map(normLine), people, lib: new Map(lib.map((i) => [i.id, i])) };
  }, [level]);

  async function decide() {
    if (!decision) return;
    setBusy(true);
    try {
      await callApi('quote.decide', { quote_id: decision.quote.id, decision: decision.kind, comment: decision.comment });
      toast(decision.kind === 'approve' ? `Đã duyệt ${decision.quote.code}` : `Đã yêu cầu sửa ${decision.quote.code}`);
      setDecision(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Duyệt báo giá" subtitle={`Hàng chờ của ${ROLE_LABEL[level]}. Chỉ báo giá ngoài khung giá cần đúng cấp của bạn mới hiện ở đây.`} />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data!.qs.length ? (
        <EmptyState title="Không có báo giá nào chờ bạn duyệt">Khi Account gửi duyệt, bạn nhận tin nhắn Telegram (nếu đã liên kết) và báo giá hiện ở đây.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {data!.qs.map((q) => {
            const lines = data!.lines.filter((l) => l.quote_id === q.id);
            const waiting = q.approval_requested_at ? workingHoursBetween(q.approval_requested_at, Date.now(), calendar) : 0;
            return (
              <Card
                key={q.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Link to={`/quotes/${q.id}`} className="hover:text-brand">
                      {q.code}
                    </Link>
                    <Badge tone="brand">Chờ {ROLE_LABEL[level]}</Badge>
                  </span>
                }
                subtitle={`${q.client} · ${personName(data!.people, q.created_by)} · gửi duyệt ${q.approval_requested_at ? fmtVnDateTime(q.approval_requested_at, tz) : ''} · đã chờ ${fmtNum(waiting, 1)} giờ làm việc`}
                actions={
                  <>
                    <Button variant="secondary" icon="edit" onClick={() => setDecision({ quote: q, kind: 'changes', comment: '' })}>
                      Yêu cầu sửa
                    </Button>
                    <Button icon="check" onClick={() => setDecision({ quote: q, kind: 'approve', comment: '' })}>
                      Duyệt
                    </Button>
                  </>
                }
              >
                <div className="rounded-xl bg-accent-soft px-4 py-3 text-[#7C3A12]">
                  <b>Vì sao cần duyệt</b>
                  <BandReasons band={q.band_detail} />
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[14.5px]">
                    <thead className="text-left text-[13px] text-ink-3">
                      <tr className="border-b border-line">
                        <th className="py-2 pr-3 font-semibold">Hạng mục</th>
                        <th className="py-2 pr-3 text-right font-semibold">SL</th>
                        <th className="py-2 pr-3 text-right font-semibold">Đơn giá</th>
                        <th className="py-2 pr-3 text-right font-semibold">Giá thư viện</th>
                        <th className="py-2 text-right font-semibold">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l) => {
                        const lp = l.library_item_id ? data!.lib.get(l.library_item_id)?.unit_price ?? null : null;
                        const dev = deviationPct(l.unit_price, lp);
                        return (
                          <tr key={l.id} className="border-b border-line-soft align-top">
                            <td className="py-2 pr-3">
                              <div className="font-semibold">{l.item_name}</div>
                              {l.override_reason && <div className="text-[13px] text-ink-3">Lý do giá: {l.override_reason}</div>}
                            </td>
                            <td className="py-2 pr-3 text-right">{fmtNum(l.qty, l.qty % 1 ? 1 : 0)}</td>
                            <td className="py-2 pr-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {dev !== null && Math.abs(dev) > 0.005 && <PriceTag unitPrice={l.unit_price} libraryPrice={lp} />}
                                {fmtVnd(l.unit_price)}
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right text-ink-3">{fmtVnd(lp)}</td>
                            <td className="py-2 text-right font-semibold">{fmtVnd(Math.round(l.qty * l.unit_price))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-6 text-[15px]">
                  <span>Chiết khấu: <b>{fmtNum(q.discount_pct, 1)}%</b></span>
                  <span>Tổng: <b>{fmtVnd(q.total)}</b></span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision ? `${decision.kind === 'approve' ? 'Duyệt' : 'Yêu cầu sửa'} ${decision.quote.code}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>
              Huỷ
            </Button>
            <Button busy={busy} disabled={decision?.kind === 'changes' && !decision.comment.trim()} onClick={decide}>
              {decision?.kind === 'approve' ? 'Duyệt báo giá' : 'Gửi yêu cầu sửa'}
            </Button>
          </>
        }
      >
        <Field label={decision?.kind === 'approve' ? 'Nhận xét (không bắt buộc)' : 'Account cần sửa gì? (bắt buộc)'}>
          {(id) => <Textarea id={id} value={decision?.comment ?? ''} onChange={(e) => setDecision((d) => (d ? { ...d, comment: e.target.value } : d))} />}
        </Field>
      </Modal>
    </div>
  );
}
