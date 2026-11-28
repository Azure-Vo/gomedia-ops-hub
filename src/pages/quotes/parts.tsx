import { forwardRef, Fragment } from 'react';
import { BAND_LABEL, BandLevel, describeReason, groupBySection, LineKind, PublicBand, QUOTE_STATUS_LABEL, QuoteStatus, quoteTotals, toRoman } from '@/domain';
import type { SettingsRow } from '@/lib/settings';
import { Badge } from '@/components/ui';
import { fmtVnd, fmtVnDate, fmtVnDateTime } from '@/lib/format';
import type { LineRow, QuoteRow } from './data';

export function StatusBadge({ status }: { status: QuoteStatus }) {
  const tone = status === 'sent' ? 'solidOk' : status === 'approved' ? 'ok' : status === 'pending' || status === 'signing' ? 'brand' : status === 'changes_requested' ? 'bad' : 'neutral';
  return <Badge tone={tone}>{QUOTE_STATUS_LABEL[status]}</Badge>;
}

/** Where the price band sent the quote. Read as a fact about pricing, not as a pending status. */
const BAND_ROUTE: Record<BandLevel, [string, string]> = {
  send_now: ['Trong khung', 'bg-ok'],
  pm: ['Ngoài khung, PM duyệt', 'bg-accent-strong'],
  ceo: ['Ngoài khung, CEO duyệt', 'bg-bad'],
};

export function BandBadge({ level }: { level: BandLevel | null }) {
  if (!level) return <span className="text-ink-3">–</span>;
  const [text, dot] = BAND_ROUTE[level];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13.5px] text-ink-2" title={BAND_LABEL[level]}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      {text}
    </span>
  );
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

/** Deviation tag shown next to a unit price: library price, or custom ±x%. */
export function PriceTag({ unitPrice, libraryPrice, kind }: { unitPrice: number; libraryPrice: number | null; kind?: LineKind }) {
  const base = 'whitespace-nowrap rounded-[4px] px-1.5 py-[1px] text-[12px] font-semibold leading-5';
  if (kind === 'pass_through') return <span className={`${base} bg-info-soft text-info`}>Chi hộ</span>;
  if (libraryPrice === null) return <span className={`${base} bg-ink/[0.06] text-ink-2`}>Ngoài thư viện</span>;
  const dev = libraryPrice > 0 ? ((unitPrice - libraryPrice) * 100) / libraryPrice : 0;
  if (Math.abs(dev) < 0.005) return <span className={`${base} bg-brand-soft text-brand`}>Giá thư viện</span>;
  return (
    <span className={`${base} bg-accent-soft text-[#9A3412]`}>
      Tự nhập {fmtDev(dev)}
    </span>
  );
}

function fmtDev(dev: number): string {
  const r = Math.round(Math.abs(dev) * 10) / 10;
  return `${dev > 0 ? '+' : '−'}${String(r).replace('.', ',')}%`;
}

/** How far the band ruler reaches either side of the library price. */
const RULER_SPAN = 30;

/**
 * Band ruler: where this line's unit price sits against its library price. The centre tick is the
 * library price; the marker is the entered price, clamped to ±30%. It turns orange only when the
 * server's band check named this line as a reason the quote left the self-send band. The rule
 * thresholds themselves stay with the CEO and are never drawn.
 */
export function BandRuler({ unitPrice, libraryPrice, kind, flagged }: { unitPrice: number; libraryPrice: number | null; kind?: LineKind; flagged: boolean }) {
  if (kind === 'pass_through') return <span className="text-[12px] font-medium text-info">Chi hộ, không xét khung giá</span>;
  if (libraryPrice === null)
    return <span className={`text-[12px] font-medium ${flagged ? 'text-accent' : 'text-ink-3'}`}>Ngoài thư viện{flagged ? ', cần duyệt' : ''}</span>;
  const dev = libraryPrice > 0 ? ((unitPrice - libraryPrice) * 100) / libraryPrice : 0;
  const same = Math.abs(dev) < 0.005;
  const clamped = Math.max(-RULER_SPAN, Math.min(RULER_SPAN, dev));
  const left = 50 + (clamped / RULER_SPAN) * 50;
  const tone = flagged ? 'bg-accent-strong' : same ? 'bg-brand' : 'bg-ink-2';
  const label = same ? 'Đúng giá thư viện' : `${fmtDev(dev)} so với giá thư viện`;
  return (
    <div className="flex w-full flex-col items-stretch gap-1 sm:w-36" title={`Giá thư viện ${libraryPrice.toLocaleString('vi-VN')} đ`}>
      <span aria-hidden="true" className="relative block h-4 w-full">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink/35" />
        {[0, 25, 75, 100].map((x) => (
          <span key={x} className="absolute top-1/2 h-[7px] w-px -translate-y-1/2 bg-ink/35" style={{ left: `${x}%` }} />
        ))}
        <span className="absolute top-0 h-4 w-[2px] -translate-x-1/2 bg-ink" style={{ left: '50%' }} />
        {!same && <span className={`absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full ${tone}`} style={{ left: `${Math.min(50, left)}%`, width: `${Math.abs(left - 50)}%` }} />}
        <span
          className={`absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${tone} ${Math.abs(dev) > RULER_SPAN ? 'rounded-[2px]' : ''}`}
          style={{ left: `${left}%` }}
        />
      </span>
      <span className={`text-right text-[12px] font-medium leading-tight ${flagged ? 'text-accent' : same ? 'text-brand' : 'text-ink-2'}`}>{label}</span>
    </div>
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

/** Go Media brand colours, sampled from the logo (navy, orange, peach, violet). */
const PDF = {
  navy: '#082774',
  orange: '#FF5E00',
  peach: '#FFBFA3',
  violet: '#600EE4',
  tint: '#FFF3EC',
  line: '#DCE0EC',
  soft: '#F4F6FB',
  ink: '#151B33',
  mute: '#5E6684',
};
const LOGO = `${import.meta.env.BASE_URL}brand/gomedia-logo-full.png`;
const num: Record<string, string> = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const td = (extra: Record<string, string | number> = {}) => ({ padding: '6px 8px', borderBottom: `1px solid ${PDF.line}`, verticalAlign: 'top', color: PDF.ink, ...extra });

/** The four quadrants of the logo as a thin bar. */
function BrandBar({ height = 4 }: { height?: number }) {
  return (
    <div style={{ display: 'flex', height: `${height}px` }}>
      {[PDF.peach, PDF.orange, PDF.violet, PDF.navy].map((c) => (
        <div key={c} style={{ flex: 1, background: c }} />
      ))}
    </div>
  );
}

export interface PdfSignature {
  image: string;
  signedAt: string | null;
  /** The CEO previewing before signing: the image is shown with a "Xem trước" mark. */
  preview?: boolean;
}

/**
 * A4 quote in Go Media's brand: logo header, client block, numbered sections with subtotals, discount,
 * VAT shown separately, totals box, terms, and the two signature boxes with the CEO's signature once signed.
 * Rendered by html2canvas, so every colour is set inline (global table styles must not leak in).
 */
export const QuotePdf = forwardRef<
  HTMLDivElement,
  {
    quote: QuoteRow;
    lines: LineRow[];
    company: CompanyInfo;
    preparedBy: string;
    tz: string;
    vatOnPassThrough: boolean;
    signature?: PdfSignature | null;
    /** 1.8 · chữ ký người lập (Account). */
    accountSignature?: { image: string; name: string; signedAt: string | null } | null;
    /** 1.8 · chữ ký khách (qua link). */
    clientSignature?: { image: string; name: string; title?: string | null; signedAt: string | null } | null;
  }
>(function QuotePdf({ quote, lines, company, preparedBy, tz, vatOnPassThrough, signature, accountSignature, clientSignature }, ref) {
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
  const head: [string, string, 'left' | 'center' | 'right'][] = [
    ['STT', '10mm', 'center'],
    ['Hạng mục / phạm vi', '', 'left'],
    ['ĐVT', '17mm', 'center'],
    ['SL', '12mm', 'center'],
    ['Đơn giá (đ)', '27mm', 'right'],
    ['Thành tiền (đ)', '29mm', 'right'],
  ];
  const label = { fontSize: '9.5px', fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase' as const, color: PDF.mute };
  return (
    <div
      ref={ref}
      className="quote-pdf"
      style={{ width: '190mm', paddingBottom: '6mm', fontFamily: 'Archivo, Arial, Helvetica, sans-serif', color: PDF.ink, background: '#FFFFFF', fontSize: '12px', lineHeight: 1.45 }}
    >
      {/* letterhead */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '2px 0 10px' }}>
        <img src={LOGO} alt="Go Media" crossOrigin="anonymous" style={{ height: '16mm', width: 'auto', display: 'block' }} />
        <div style={{ textAlign: 'right', fontSize: '10.5px', color: PDF.mute, lineHeight: 1.5 }}>
          <div style={{ color: PDF.navy, fontWeight: 700, fontSize: '12px' }}>{company.name.toUpperCase()}</div>
          {company.taxCode && <div>MST {company.taxCode}</div>}
          {company.address && <div>{company.address}</div>}
          {(company.phone || company.website) && <div>{[company.phone, company.website].filter(Boolean).join('   |   ')}</div>}
        </div>
      </div>
      <BrandBar />

      {/* title + reference */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', margin: '12px 0 10px' }}>
        <div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: PDF.navy, letterSpacing: '0.5px', lineHeight: 1.1 }}>BÁO GIÁ</div>
          <div style={{ marginTop: '4px', color: PDF.orange, fontWeight: 600, fontSize: '12px' }}>{quote.kind === 'project' ? 'Báo giá dự án' : 'Báo giá dịch vụ'}</div>
        </div>
        <table style={{ borderCollapse: 'collapse', fontSize: '11.5px' }}>
          <tbody>
            {[
              ['Số báo giá', quote.code],
              ['Ngày', fmtVnDate(date, tz)],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '2px 10px 2px 0', color: PDF.mute, textAlign: 'right' }}>{k}</td>
                <td style={{ padding: '2px 0', fontWeight: 700, color: PDF.navy, textAlign: 'right', ...num }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* client */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 18px', background: PDF.tint, borderLeft: `3px solid ${PDF.orange}`, padding: '10px 14px', marginBottom: '14px' }}>
        {info.map(([k, v]) => (
          <div key={k}>
            <div style={label}>{k}</div>
            <div style={{ fontSize: '12.5px', fontWeight: k === 'Kính gửi' ? 700 : 500, color: PDF.ink }}>{v?.trim() || '—'}</div>
          </div>
        ))}
      </div>

      {/* lines */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {head.map(([h, w, align]) => (
              <th key={h} style={{ width: w || undefined, textAlign: align, padding: '8px', background: PDF.navy, color: '#FFFFFF', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((sec, si) => (
            <Fragment key={sec.title}>
              <tr>
                <td colSpan={6} style={td({ background: PDF.tint, fontWeight: 700, color: PDF.navy, borderLeft: `3px solid ${PDF.orange}`, paddingTop: '6px', paddingBottom: '6px' })}>
                  {toRoman(si + 1)}. {sec.title}
                </td>
              </tr>
              {sec.lines.map(({ line: l }) => {
                stt += 1;
                return (
                  <tr key={l.id ?? `${si}-${stt}`}>
                    <td style={td({ textAlign: 'center', color: PDF.mute, ...num })}>{stt}</td>
                    <td style={td()}>
                      <div style={{ fontWeight: 600 }}>
                        {l.item_name}
                        {l.kind === 'pass_through' && !/chi hộ/i.test(l.item_name) && <span style={{ color: PDF.mute, fontWeight: 400 }}> (chi hộ)</span>}
                      </div>
                      {l.description?.trim() && <div style={{ color: PDF.mute, fontSize: '11px', marginTop: '1px' }}>{l.description}</div>}
                    </td>
                    <td style={td({ textAlign: 'center' })}>{l.unit}</td>
                    <td style={td({ textAlign: 'center', ...num })}>{pct(l.qty)}</td>
                    <td style={td({ textAlign: 'right', ...num })}>{fmtVnd(l.unit_price, false)}</td>
                    <td style={td({ textAlign: 'right', fontWeight: 600, ...num })}>{fmtVnd(Math.round(l.qty * l.unit_price), false)}</td>
                  </tr>
                );
              })}
              {sections.length > 1 && (
                <tr>
                  <td colSpan={5} style={td({ textAlign: 'right', color: PDF.mute, fontWeight: 600 })}>
                    Tổng phần {toRoman(si + 1)}
                  </td>
                  <td style={td({ textAlign: 'right', fontWeight: 700, color: PDF.navy, ...num })}>{fmtVnd(sec.amount, false)}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      {/* totals */}
      <div className="no-break" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
        <table style={{ width: '96mm', borderCollapse: 'collapse', fontSize: '12px' }}>
          <tbody>
            {[
              ['Cộng tiền hàng', fmtVnd(t.subtotal, false)],
              [`Chiết khấu ${pct(quote.discount_pct)}%${t.passThrough > 0 ? ' (trừ chi hộ)' : ''}`, t.discountAmount ? `− ${fmtVnd(t.discountAmount, false)}` : '0'],
              [`Thuế GTGT ${pct(t.vatPct)}%${t.passThrough > 0 && !vatOnPassThrough ? ' (trừ chi hộ)' : ''}`, fmtVnd(t.vatAmount, false)],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '5px 8px', color: PDF.mute, borderBottom: `1px solid ${PDF.line}` }}>{k}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: `1px solid ${PDF.line}`, ...num }}>{v}</td>
              </tr>
            ))}
            <tr>
              <td style={{ padding: '9px 8px', background: PDF.navy, color: '#FFFFFF', fontWeight: 700, fontSize: '12.5px', borderTop: `3px solid ${PDF.orange}` }}>TỔNG THANH TOÁN</td>
              <td style={{ padding: '9px 8px', background: PDF.navy, color: '#FFFFFF', fontWeight: 800, fontSize: '15px', textAlign: 'right', borderTop: `3px solid ${PDF.orange}`, ...num }}>{fmtVnd(t.grandTotal, false)} đ</td>
            </tr>
          </tbody>
        </table>
      </div>

      {quote.terms.length > 0 && (
        <div className="no-break" style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: PDF.navy, fontSize: '12.5px' }}>
            <span style={{ width: '8px', height: '8px', background: PDF.orange, display: 'inline-block' }} />
            Điều khoản và ghi chú
          </div>
          <ol style={{ margin: '5px 0 0', paddingLeft: '20px', listStyle: 'decimal' }}>
            {quote.terms.map((x, i) => (
              <li key={i} style={{ marginBottom: '2px' }}>
                {x}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* signatures (1.8: khách hàng · người lập · đại diện Go Media) */}
      <div className="no-break" style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', marginTop: '22px', gap: '8px' }}>
        <SignBox
          title="ĐẠI DIỆN KHÁCH HÀNG"
          hint="(Ký, ghi rõ họ tên)"
          image={clientSignature?.image}
          name={clientSignature?.name}
          role={clientSignature?.title ?? undefined}
          stamp={clientSignature?.signedAt ? `Ký qua link lúc ${fmtVnDateTime(clientSignature.signedAt, tz)}` : undefined}
        />
        <SignBox
          title="NGƯỜI LẬP"
          hint="(Account phụ trách)"
          image={accountSignature?.image}
          name={accountSignature?.name || preparedBy}
          stamp={accountSignature?.signedAt ? `Ký lúc ${fmtVnDateTime(accountSignature.signedAt, tz)}` : undefined}
        />
        <SignBox
          title={`ĐẠI DIỆN ${company.shortName.toUpperCase()}`}
          hint="(Ký, đóng dấu)"
          image={signature?.image}
          preview={signature?.preview}
          name={company.signerName}
          role={company.signerTitle}
          stamp={signature?.signedAt ? `Đã ký trên Go Media Ops Hub lúc ${fmtVnDateTime(signature.signedAt, tz)}` : undefined}
        />
      </div>

      <div style={{ marginTop: '18px' }}>
        <BrandBar height={2} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '9.5px', color: PDF.mute }}>
          <span>Người lập: {preparedBy}</span>
          <span>{company.website || company.shortName}</span>
        </div>
      </div>
    </div>
  );
});

function SignBox({ title, hint, image, preview, name, role, stamp }: { title: string; hint: string; image?: string | null; preview?: boolean; name?: string; role?: string; stamp?: string }) {
  return (
    <div style={{ width: '32%' }}>
      <div style={{ fontWeight: 700, color: PDF.navy, fontSize: '11px' }}>{title}</div>
      <div style={{ fontStyle: 'italic', color: PDF.mute, fontSize: '10px' }}>{hint}</div>
      <div style={{ height: '22mm', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {image && <img src={image} alt="Chữ ký" style={{ maxHeight: '20mm', maxWidth: '52mm', display: 'block' }} />}
        {preview && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: PDF.orange, fontWeight: 800, fontSize: '14px', letterSpacing: '2px', opacity: 0.75, transform: 'rotate(-12deg)' }}>XEM TRƯỚC</div>
        )}
      </div>
      {name && <div style={{ fontWeight: 700, fontSize: '11.5px' }}>{name}</div>}
      {role && <div style={{ color: PDF.mute, fontSize: '10.5px' }}>{role}</div>}
      {stamp && <div style={{ color: PDF.mute, fontSize: '9px', marginTop: '3px' }}>{stamp}</div>}
    </div>
  );
}

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
