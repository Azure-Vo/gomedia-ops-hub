import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtNum, localToMs, QUOTE_STATUS_LABEL, quoteKpis, QuoteStatus, turnaroundByBand, workingHoursBetween } from '@/domain';
import { Badge, Button, Card, EmptyState, ErrorBox, Icon, Loading, PageHeader, Select, useAsync, useToast } from '@/components/ui';
import { fmtVnd, fmtVnDateTime } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { loadPeople, normQuote, payable, personName, QUOTE_COLS, QuoteRow } from './data';
import { BandBadge, StatusBadge } from './parts';
import { loadOpenCounts } from './review';
import { QuoteKpiTiles } from './QuoteKpiTiles';

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
    const list = (check(rows) as QuoteRow[]).map(normQuote);
    // Review comments still open, so the Account sees at a glance which quotes need a fix.
    const open = await loadOpenCounts(list.filter((x) => x.status !== 'sent').map((x) => x.id));
    return { rows: list, people, open };
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
  // Only the Account role creates quotes (the database enforces it too), so other roles are told why there is no button.
  const subtitle =
    me.role === 'account'
      ? 'Báo giá của bạn. Thời gian tính bằng giờ làm việc, từ lúc khách gửi yêu cầu đến lúc gửi báo giá.'
      : me.role === 'pm' || me.role === 'ceo'
        ? 'Mọi báo giá tạo trong app. Chỉ vai trò Account tạo được báo giá mới; báo giá chờ bạn duyệt nằm ở trang Duyệt báo giá.'
        : 'Mọi báo giá tạo trong app. Chỉ vai trò Account tạo được báo giá mới.';
  return (
    <div>
      <PageHeader
        title="Báo giá"
        subtitle={subtitle}
        actions={
          me.role === 'account' && (
            <Button icon="plus" busy={creating} onClick={create}>
              Tạo báo giá
            </Button>
          )
        }
      />
      <KpiCard />
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
          <div className="relative overflow-x-auto">
            <table className="w-full text-left text-[14.5px] sm:min-w-[860px]">
              <thead className="text-[13px] text-ink-3">
                <tr className="border-b-2 border-ink">
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
                    <tr key={q.id} className="border-b border-line-soft transition-colors hover:bg-canvas/70">
                      <td className="py-2.5 pr-3">
                        <Link className="whitespace-nowrap font-semibold text-brand underline-offset-[3px] hover:underline" to={`/quotes/${q.id}`}>
                          {q.code}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3">{q.client || <span className="text-ink-3">(chưa nhập)</span>}</td>
                      {me.role !== 'account' && <td className="hidden py-2.5 pr-3 sm:table-cell">{personName(data!.people, q.created_by)}</td>}
                      <td className="py-2.5 pr-3">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={q.status} />
                          {(data!.open.get(q.id) ?? 0) > 0 && (
                            <Badge tone="warn">
                              <Icon name="message" size={12} />
                              {data!.open.get(q.id)} góp ý
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="hidden py-2.5 pr-3 sm:table-cell">
                        <BandBadge level={q.band_result} />
                      </td>
                      <td className="hidden py-2.5 pr-3 text-right tabular-nums sm:table-cell">{fmtVnd(payable(q))}</td>
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

const dayMs = (date: string, tz: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return localToMs(y, m, d, 0, 0, tz);
};
const vnDate = (date: string) => date.split('-').reverse().join('/');

/** S2 KPIs over the pilot period (Admin → Cài đặt), the same figures as the Dashboard. */
function KpiCard() {
  const me = useProfile();
  const { settings, calendar, tz } = useSettings();
  const from = settings?.pilot_start ?? null;
  const to = settings?.pilot_end ?? null;
  const { data, error } = useAsync(async () => {
    let q = supabase.from('quotes').select('id, requested_at, sent_at, band_result').eq('status', 'sent').eq('source', 'app');
    if (from) q = q.gte('sent_at', new Date(dayMs(from, tz)).toISOString());
    if (to) q = q.lt('sent_at', new Date(dayMs(to, tz) + 86_400_000).toISOString());
    return check(await q) as { id: string; requested_at: string; sent_at: string; band_result: 'send_now' | 'pm' | 'ceo' | null }[];
  }, [from, to, tz]);
  if (error) return null;
  const late = settings?.quote_late_hours ?? 8;
  const qs = (data ?? []).map((q) => ({ id: q.id, requestedAt: Date.parse(q.requested_at), sentAt: Date.parse(q.sent_at), bandResult: q.band_result }));
  const k = quoteKpis(qs, calendar, late);
  const period = from && to ? ` trong kỳ pilot ${vnDate(from)}–${vnDate(to)}` : '';
  return (
    <Card
      className="mb-4"
      title="Chỉ số báo giá (S2)"
      subtitle={`${k.count} báo giá đã gửi${period} · thời gian = giờ làm việc từ lúc khách yêu cầu đến lúc gửi`}
      actions={
        ['pm', 'ceo', 'admin'].includes(me.role) ? (
          <Link to="/dashboard" className="text-[14px] font-bold text-brand underline">
            Xem Dashboard
          </Link>
        ) : undefined
      }
    >
      {data ? <QuoteKpiTiles k={k} byBand={turnaroundByBand(qs, calendar, late)} settings={settings} /> : <p className="text-ink-3">Đang tính…</p>}
    </Card>
  );
}
