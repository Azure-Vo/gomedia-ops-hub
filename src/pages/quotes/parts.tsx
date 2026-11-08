import { forwardRef, Fragment } from 'react';
import { BAND_LABEL, BandLevel, describeReason, groupBySection, LineKind, PublicBand, QUOTE_STATUS_LABEL, QuoteStatus, quoteTotals, toRoman } from '@/domain';
import type { SettingsRow } from '@/lib/settings';
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
export function PriceTag({ unitPrice, libraryPrice, kind }: { unitPrice: number; libraryPrice: number | null; kind?: LineKind }) {
  if (kind === 'pass_through') return <span className="whitespace-nowrap rounded-md bg-[#E6F0FF] px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-[#1D4ED8]">CHI HỘ</span>;
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

export interface CompanyInfo {
  /** Legal name for the header band. */
  name: string;
  /** Short name for the signature box (ĐẠI DIỆN GO MEDIA). */
  shortName: string;
  taxCode: string;
  address: string;
  phone: string;
  website: string;
  signerName: string;
  signerTitle: string;
}

export function companyFromSettings(s: SettingsRow | null): CompanyInfo {
  return {
    name: s?.company_legal_name?.trim() || s?.company_name || 'Go Media',
    shortName: s?.company_name || 'Go Media',
    taxCode: s?.company_tax_code ?? '',
    address: s?.company_address ?? '',
    phone: s?.company_phone ?? '',
    website: s?.company_website ?? '',
    signerName: s?.signer_name ?? '',
    signerTitle: s?.signer_title ?? '',
  };
}

const PDF = { navy: '#1F2238', orange: '#D9822B', cream: '#FFF4E5', line: '#C9C7D6', soft: '#F3F2F8', ink: '#1F2238', mute: '#6B6985' };
const cell = (extra: Record<string, string | number> = {}) => ({ padding: '6px 7px', border: `1px solid ${PDF.line}`, verticalAlign: 'top', ...extra });

/**
 * A4 quote in Go Media's own layout (the CEO's "Go Quote AI" sample): company band, client block,
 * numbered sections with a subtotal each, discount, VAT shown separately, terms and two signature boxes.
 */
export const QuotePdf = forwardRef<
  HTMLDivElement,
  { quote: QuoteRow; lines: LineRow[]; company: CompanyInfo; preparedBy: string; tz: string; vatOnPassThrough: boolean }
>(function QuotePdf({ quote, lines, company, preparedBy, tz, vatOnPassThrough }, ref) {
  const date = quote.sent_at ?? new Date().toISOString();
  const t = quoteTotals(
    lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price, kind: l.kind })),
    quote.discount_pct,
    { pct: quote.vat_pct, onPassThrough: vatOnPassThrough },
  );
  const sections = groupBySection(lines.map((l) => ({ ...l, unitPrice: l.unit_price })));
  const pct = (v: number) => String(v).replace('.', ',');
  let stt = 0;
  const info: [string, string][] = [
    ['Kính gửi', quote.client],
    ['Người liên hệ', quote.contact],
    ['Dự án', quote.project],
    ['Địa điểm', quote.venue],
  ];
  return (
    <div ref={ref} style={{ width: '190mm', paddingBottom: '8mm', fontFamily: '"Times New Roman", Times, serif', color: PDF.ink, background: '#FFFFFF', fontSize: '12.5px', lineHeight: 1.35 }}>
      <div style={{ background: PDF.navy, color: '#FFFFFF', padding: '14px 18px' }}>
        <div style={{ color: PDF.orange, fontWeight: 700, fontSize: '16px', letterSpacing: '0.2px' }}>{company.name.toUpperCase()}</div>
        {(company.taxCode || company.address) && (
          <div style={{ fontSize: '11px', marginTop: '3px', opacity: 0.9 }}>{[company.taxCode && `MST ${company.taxCode}`, company.address].filter(Boolean).join(' · ')}</div>
        )}
        {(company.website || company.phone) && <div style={{ fontSize: '11px', opacity: 0.9 }}>{[company.website, company.phone].filter(Boolean).join(' · ')}</div>}
        <div style={{ textAlign: 'center', fontSize: '22px', fontWeight: 700, marginTop: '10px', letterSpacing: '1px' }}>BÁO GIÁ</div>
        <div style={{ fontSize: '11px', opacity: 0.9 }}>
          Số: {quote.code} · Ngày {fmtVnDate(date, tz)}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '12px 0' }}>
        <tbody>
          {info.map(([k, v]) => (
            <tr key={k}>
              <td style={cell({ width: '32mm', fontWeight: 700, background: PDF.soft })}>{k}</td>
              <td style={cell()}>{v?.trim() || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: PDF.navy, color: '#FFFFFF' }}>
            {[
              ['STT', '9mm', 'center'],
              ['Hạng mục / phạm vi', '', 'left'],
              ['ĐVT', '18mm', 'center'],
              ['SL', '11mm', 'center'],
              ['Đơn giá (đ)', '27mm', 'right'],
              ['Thành tiền (đ)', '29mm', 'right'],
            ].map(([h, w, align]) => (
              <th key={h} style={cell({ width: w, textAlign: align, fontWeight: 700, borderColor: PDF.navy })}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((sec, si) => (
            <Fragment key={sec.title}>
              <tr style={{ background: PDF.cream }}>
                <td colSpan={6} style={cell({ fontWeight: 700 })}>
                  {toRoman(si + 1)}. {sec.title}
                </td>
              </tr>
              {sec.lines.map(({ line: l }) => {
                stt += 1;
                return (
                  <tr key={l.id ?? `${si}-${stt}`}>
                    <td style={cell({ textAlign: 'center' })}>{stt}</td>
                    <td style={cell()}>
                      <div>
                        {l.item_name}
                        {l.kind === 'pass_through' && !/chi hộ/i.test(l.item_name) && <span style={{ color: PDF.mute }}> (chi hộ)</span>}
                      </div>
                      {l.description?.trim() && <div style={{ fontStyle: 'italic', color: PDF.mute, fontSize: '11.5px' }}>{l.description}</div>}
                    </td>
                    <td style={cell({ textAlign: 'center' })}>{l.unit}</td>
                    <td style={cell({ textAlign: 'center' })}>{pct(l.qty)}</td>
                    <td style={cell({ textAlign: 'right' })}>{fmtVnd(l.unit_price, false)}</td>
                    <td style={cell({ textAlign: 'right' })}>{fmtVnd(Math.round(l.qty * l.unit_price), false)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: PDF.soft }}>
                <td colSpan={5} style={cell({ textAlign: 'right', fontWeight: 700 })}>
                  Tổng phần {toRoman(si + 1)}
                </td>
                <td style={cell({ textAlign: 'right', fontWeight: 700 })}>{fmtVnd(sec.amount, false)}</td>
              </tr>
            </Fragment>
          ))}
          <tr>
            <td colSpan={5} style={cell({ textAlign: 'right', fontWeight: 700 })}>
              Cộng tiền hàng
            </td>
            <td style={cell({ textAlign: 'right' })}>{fmtVnd(t.subtotal, false)}</td>
          </tr>
          <tr>
            <td colSpan={5} style={cell({ textAlign: 'right' })}>
              Chiết khấu {pct(quote.discount_pct)}%{t.passThrough > 0 ? ' (không áp cho khoản chi hộ)' : ''}
            </td>
            <td style={cell({ textAlign: 'right' })}>{t.discountAmount ? `− ${fmtVnd(t.discountAmount, false)}` : '0'}</td>
          </tr>
          <tr>
            <td colSpan={5} style={cell({ textAlign: 'right' })}>
              Thuế GTGT {pct(t.vatPct)}%{t.passThrough > 0 && !vatOnPassThrough ? ' (không tính trên khoản chi hộ)' : ''}
            </td>
            <td style={cell({ textAlign: 'right' })}>{fmtVnd(t.vatAmount, false)}</td>
          </tr>
          <tr style={{ background: PDF.orange, color: '#FFFFFF' }}>
            <td colSpan={5} style={cell({ textAlign: 'right', fontWeight: 700, fontSize: '14px', borderColor: PDF.orange })}>
              TỔNG THANH TOÁN
            </td>
            <td style={cell({ textAlign: 'right', fontWeight: 700, fontSize: '14px', borderColor: PDF.orange })}>{fmtVnd(t.grandTotal, false)}</td>
          </tr>
        </tbody>
      </table>

      {quote.terms.length > 0 && (
        <div className="no-break" style={{ marginTop: '14px' }}>
          <div style={{ fontWeight: 700 }}>Điều khoản và ghi chú</div>
          <ol style={{ margin: '4px 0 0', paddingLeft: '20px', listStyle: 'decimal' }}>
            {quote.terms.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="no-break" style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', marginTop: '22px' }}>
        <div style={{ width: '45%' }}>
          <div style={{ fontWeight: 700 }}>ĐẠI DIỆN KHÁCH HÀNG</div>
          <div style={{ fontStyle: 'italic', color: PDF.mute, fontSize: '11px' }}>(Ký, ghi rõ họ tên)</div>
        </div>
        <div style={{ width: '45%' }}>
          <div style={{ fontWeight: 700 }}>ĐẠI DIỆN {company.shortName.toUpperCase()}</div>
          <div style={{ fontStyle: 'italic', color: PDF.mute, fontSize: '11px' }}>(Ký, đóng dấu)</div>
          <div style={{ height: '62px' }} />
          {company.signerName && <div style={{ fontWeight: 700 }}>{company.signerName}</div>}
          {company.signerTitle && <div>{company.signerTitle}</div>}
        </div>
      </div>
      <div style={{ marginTop: '14px', fontSize: '10.5px', color: PDF.mute }}>Người lập: {preparedBy}</div>
    </div>
  );
});

export async function downloadQuotePdf(el: HTMLElement, code: string) {
  const mod = (await import('html2pdf.js')) as unknown as { default: () => Html2Pdf };
  await mod
    .default()
    .set({
      margin: 10,
      filename: `${code}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#FFFFFF', scrollX: 0, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css'], avoid: ['tr', '.no-break'] },
    })
    .from(el)
    .save();
}

interface Html2Pdf {
  set(opts: Record<string, unknown>): Html2Pdf;
  from(el: HTMLElement): Html2Pdf;
  save(): Promise<void>;
}
