import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtNum, workingHoursBetween } from '@/domain';
import { Badge, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, Select, useAsync } from '@/components/ui';
import { fmtVnd, fmtVnDate } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';

interface ArchiveRow {
  id: string;
  code: string;
  client: string;
  service_group: string | null;
  requested_at: string;
  sent_at: string;
  total: number;
  discount_pct: number;
  source: 'app' | 'import';
  quote_lines: { item_name: string; qty: number; library_item_id: string | null }[];
}

export function ArchivePage() {
  const { calendar, tz } = useSettings();
  const [text, setText] = useState('');
  const [group, setGroup] = useState('');
  const { data, error, loading } = useAsync(async () => {
    const rows = check(
      await supabase
        .from('quotes')
        .select('id, code, client, service_group, requested_at, sent_at, total, discount_pct, source, quote_lines(item_name, qty, library_item_id)')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(1000),
    ) as ArchiveRow[];
    return rows.map((r) => ({ ...r, total: Number(r.total) }));
  }, []);

  const groups = useMemo(() => [...new Set((data ?? []).map((r) => r.service_group).filter(Boolean) as string[])].sort(), [data]);
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        (!group || r.service_group === group) &&
        (!t || `${r.code} ${r.client} ${r.quote_lines.map((l) => l.item_name).join(' ')}`.toLowerCase().includes(t)),
    );
  }, [data, text, group]);

  return (
    <div>
      <PageHeader title="Kho tham chiếu" subtitle="Mọi báo giá đã gửi, kể cả dữ liệu lịch sử đã import. Mở một báo giá để xem chi tiết hoặc tải PDF." />
      <Card
        actions={
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Tìm theo mã, khách, hạng mục" placeholder="Tìm mã, khách, hạng mục…" value={text} onChange={(e) => setText(e.target.value)} className="w-64" />
            <Select aria-label="Nhóm dịch vụ" value={group} onChange={(e) => setGroup(e.target.value)} className="w-52">
              <option value="">Mọi nhóm dịch vụ</option>
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </div>
        }
        title={`${rows.length} báo giá`}
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !rows.length ? (
          <EmptyState title="Không có báo giá phù hợp" />
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link to={`/quotes/${r.id}`} className="font-bold text-brand hover:underline">
                    {r.code}
                  </Link>{' '}
                  <span className="text-ink">· {r.client}</span> {r.source === 'import' && <Badge>lịch sử</Badge>}
                  <div className="text-[13.5px] text-ink-3">
                    {r.service_group ?? 'Chưa phân nhóm'} · {r.quote_lines.slice(0, 4).map((l) => `${Number(l.qty)} × ${l.item_name}`).join(', ')}
                    {r.quote_lines.length > 4 ? '…' : ''}
                  </div>
                </div>
                <div className="text-right text-[14px]">
                  <div className="font-semibold">{fmtVnd(r.total)}</div>
                  <div className="text-ink-3">
                    {fmtVnDate(r.sent_at, tz)} · {fmtNum(workingHoursBetween(r.requested_at, r.sent_at, calendar), 1)} giờ
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
