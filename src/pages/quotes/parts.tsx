import { forwardRef } from 'react';
import { BAND_LABEL, BandLevel, describeReason, PublicBand, QUOTE_STATUS_LABEL, QuoteStatus } from '@/domain';
import { Badge } from '@/components/ui';
import { fmtVnd, fmtVnDate } from '@/lib/format';
import type { LineRow, QuoteRow } from './data';

export function StatusBadge({ status }: { status: QuoteStatus }) {
  const tone = status === 'sent' ? 'solidOk' : status === 'approved' ? 'ok' : status === 'pending' ? 'brand' : status === 'changes_requested' ? 'bad' : 'neutral';
  return <Badge tone={tone}>{QUOTE_STATUS_LABEL[status]}</Badge>;
}

export function BandBadge({ level }: { level: BandLevel | null }) {
  if (!level) return <span className="text-ink-3">–</span>;
  return <Badge tone={level === 'send_now' ? 'ok' : level === 'pm' ? 'accent' : 'brand'}>{BAND_LABEL[level]}</Badge>;
}

export function BandReasons({ band }: { band: PublicBand | null | undefined }) {
  if (!band || !band.reasons.length) return null;
  return (
    <ul className="mt-1 list-disc pl-5 text-sm">
      {band.reasons.map((r, i) => (
        <li key={i}>{describeReason(r)}</li>
      ))}
    </ul>
  );
}

/** Deviation tag shown next to a unit price: LIBRARY, or CUSTOM ±x%. */
export function PriceTag({ unitPrice, libraryPrice }: { unitPrice: number; libraryPrice: number | null }) {
  if (libraryPrice === null) return <span className="whitespace-nowrap rounded-md bg-line-soft px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-ink-2">NGOÀI THƯ VIỆN</span>;
  const dev = libraryPrice > 0 ? ((unitPrice - libraryPrice) * 100) / libraryPrice : 0;
  if (Math.abs(dev) < 0.005) return <span className="whitespace-nowrap rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-accent">THƯ VIỆN</span>;
  const r = Math.round(Math.abs(dev) * 10) / 10;
  return (
    <span className="whitespace-nowrap rounded-md bg-[#FDE7D3] px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-[#9A3412]">
      TỰ NHẬP {dev > 0 ? '+' : '−'}
      {String(r).replace('.', ',')}%
    </span>
  );
}

/** A4 print template used for the PDF the Account sends to the client. */
export const QuotePdf = forwardRef<HTMLDivElement, { quote: QuoteRow; lines: LineRow[]; company: string; preparedBy: string; tz: string }>(function QuotePdf(
  { quote, lines, company, preparedBy, tz },
  ref,
) {
  const date = quote.sent_at ?? new Date().toISOString();
  const subtotal = lines.reduce((s, l) => s + Math.round(l.qty * l.unit_price), 0);
  const discount = Math.round((subtotal * quote.discount_pct) / 100);
  return (
    <div ref={ref} style={{ width: '190mm', padding: '6mm', fontFamily: 'Inter, Arial, sans-serif', color: '#24224F', background: '#FFFFFF' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #1800AD', paddingBottom: '10px' }}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1800AD' }}>{company.toUpperCase()}</div>
          <div style={{ fontSize: '12px', color: '#5D5B80', marginTop: '2px' }}>Báo giá dịch vụ</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '12px' }}>
          <div style={{ fontSize: '18px', fontWeight: 800 }}>BÁO GIÁ</div>
          <div>Số: {quote.code}</div>
          <div>Ngày: {fmtVnDate(date, tz)}</div>
        </div>
      </div>
      <div style={{ margin: '14px 0', fontSize: '13px' }}>
        Kính gửi: <b>{quote.client || '—'}</b>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#24224F', color: '#FFFFFF' }}>
            {['STT', 'Hạng mục', 'Đơn vị', 'SL', 'Đơn giá (đ)', 'Thành tiền (đ)'].map((h, i) => (
              <th key={h} style={{ padding: '7px 6px', textAlign: i >= 3 ? 'right' : 'left', fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} style={{ borderBottom: '1px solid #DEDCEB' }}>
              <td style={{ padding: '6px' }}>{i + 1}</td>
              <td style={{ padding: '6px' }}>{l.item_name}</td>
              <td style={{ padding: '6px' }}>{l.unit}</td>
              <td style={{ padding: '6px', textAlign: 'right' }}>{String(l.qty).replace('.', ',')}</td>
              <td style={{ padding: '6px', textAlign: 'right' }}>{fmtVnd(l.unit_price, false)}</td>
              <td style={{ padding: '6px', textAlign: 'right' }}>{fmtVnd(Math.round(l.qty * l.unit_price), false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginLeft: 'auto', width: '75mm', marginTop: '10px', fontSize: '12.5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
          <span>Cộng</span>
          <span>{fmtVnd(subtotal)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
          <span>Chiết khấu ({String(quote.discount_pct).replace('.', ',')}%)</span>
          <span>− {fmtVnd(discount)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '2px solid #24224F', fontSize: '15px', fontWeight: 800 }}>
          <span>Tổng cộng</span>
          <span>{fmtVnd(subtotal - discount)}</span>
        </div>
      </div>
      <div style={{ marginTop: '24px', fontSize: '12px', color: '#4A4870' }}>Người lập: {preparedBy}</div>
    </div>
  );
});

export async function downloadQuotePdf(el: HTMLElement, code: string) {
  const mod = (await import('html2pdf.js')) as unknown as { default: () => Html2Pdf };
  await mod
    .default()
    .set({ margin: 8, filename: `${code}.pdf`, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } })
    .from(el)
    .save();
}

interface Html2Pdf {
  set(opts: Record<string, unknown>): Html2Pdf;
  from(el: HTMLElement): Html2Pdf;
  save(): Promise<void>;
}
