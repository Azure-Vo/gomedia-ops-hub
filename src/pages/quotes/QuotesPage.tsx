import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtNum, QUOTE_STATUS_LABEL, QuoteStatus, workingHoursBetween } from '@/domain';
import { Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Select, useAsync, useToast } from '@/components/ui';
import { fmtVnd, fmtVnDateTime } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { loadPeople, normQuote, personName, QUOTE_COLS, QuoteRow } from './data';
import { BandBadge, StatusBadge } from './parts';

export function QuotesPage() {
  const me = useProfile();
  const { calendar, tz, settings } = useSettings();
  const nav = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState<'open' | QuoteStatus | 'all'>('open');
  const [creating, setCreating] = useState(false);
  const { data, error, loading } = useAsync(async () => {
    let q = supabase.from('quotes').select(QUOTE_COLS).eq('source', 'app').order('created_at', { ascending: false }).limit(500);
    if (me.role === 'account') q = q.eq('created_by', me.id);
    const [rows, people] = await Promise.all([q, loadPeople()]);
    return { rows: (check(rows) as QuoteRow[]).map(normQuote), people };
  }, [me.id]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (status === 'all') return all;
    if (status === 'open') return all.filter((q) => q.status !== 'sent');
    return all.filter((q) => q.status === status);
  }, [data, status]);

  async function create() {
    setCreating(true);
    try {
      const q = check(await supabase.from('quotes').insert({ client: '', requested_at: new Date().toISOString() }).select('id').single()) as { id: string };
      nav(`/quotes/${q.id}`);
    } catch (e) {
      toast((e as Error).message, 'bad');
      setCreating(false);
    }
  }

  const late = settings?.quote_late_hours ?? 8;
  return (
    <div>
      <PageHeader
        title="Báo giá"
        subtitle={me.role === 'account' ? 'Báo giá của bạn. Thời gian tính bằng giờ làm việc, từ lúc khách gửi yêu cầu đến lúc gửi báo giá.' : 'Mọi báo giá tạo trong app.'}
        actions={
          me.role === 'account' && (
            <Button icon="plus" busy={creating} onClick={create}>
              Tạo báo giá
            </Button>
          )
        }
      />
      <Card
        title="Danh sách"
        actions={
          <Select aria-label="Lọc trạng thái" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-56">
            <option value="open">Chưa gửi</option>
            <option value="all">Tất cả</option>
            {(Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[]).map((s) => (
              <option key={s} value={s}>
                {QUOTE_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        }
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !rows.length ? (
          <EmptyState title="Chưa có báo giá nào ở mục này">{me.role === 'account' ? 'Bấm Tạo báo giá để bắt đầu.' : 'Account tạo báo giá trong app thì sẽ hiện ở đây.'}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14.5px] sm:min-w-[860px]">
              <thead className="text-[13px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Mã</th>
                  <th className="py-2 pr-3 font-semibold">Khách</th>
                  {me.role !== 'account' && <th className="hidden py-2 pr-3 font-semibold sm:table-cell">Account</th>}
                  <th className="py-2 pr-3 font-semibold">Trạng thái</th>
                  <th className="hidden py-2 pr-3 font-semibold sm:table-cell">Khung giá</th>
                  <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell">Tổng</th>
                  <th className="hidden py-2 pr-3 font-semibold sm:table-cell">Khách yêu cầu</th>
                  <th className="py-2 text-right font-semibold"><span className="sm:hidden">Giờ</span><span className="hidden sm:inline">Giờ làm việc</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => {
                  const h = workingHoursBetween(q.requested_at, q.sent_at ?? Date.now(), calendar);
                  return (
                    <tr key={q.id} className="border-b border-line-soft hover:bg-canvas">
                      <td className="py-2.5 pr-3">
                        <Link className="whitespace-nowrap font-bold text-brand hover:underline" to={`/quotes/${q.id}`}>
                          {q.code}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3">{q.client || <span className="text-ink-3">(chưa nhập)</span>}</td>
                      {me.role !== 'account' && <td className="hidden py-2.5 pr-3 sm:table-cell">{personName(data!.people, q.created_by)}</td>}
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={q.status} />
                      </td>
                      <td className="hidden py-2.5 pr-3 sm:table-cell">
                        <BandBadge level={q.band_result} />
                      </td>
                      <td className="hidden py-2.5 pr-3 text-right tabular-nums sm:table-cell">{fmtVnd(q.total)}</td>
                      <td className="hidden py-2.5 pr-3 text-ink-2 sm:table-cell">{fmtVnDateTime(q.requested_at, tz)}</td>
                      <td className={`py-2.5 text-right font-semibold tabular-nums ${h > late ? 'text-bad' : 'text-ink'}`}>
                        {fmtNum(h, 2)}
                        {!q.sent_at && <span className="hidden font-normal text-ink-3 sm:inline"> (đang chạy)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
