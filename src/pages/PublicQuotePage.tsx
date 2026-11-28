// 1.8 · Trang cho khách (không cần đăng nhập): xem báo giá, ký xác nhận hoặc đề nghị điều chỉnh.
// Khách không sửa được nội dung và không thấy góp ý nội bộ của Go Media.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Banner, Button, Field, Input, Loading } from '@/components/ui';
import { fmtVnDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { DrawPad } from './SignaturePad';
import type { LineRow, QuoteRow } from './quotes/data';
import { CompanyInfo, downloadQuotePdf, QuotePdf } from './quotes/parts';

interface PublicData {
  quote: QuoteRow & { client_viewed_at: string | null; client_signed_at: string | null; client_signer_name: string | null; client_signer_title: string | null; client_signature: string | null; client_note: string | null };
  lines: LineRow[];
  preparedBy: string;
  company: CompanyInfo;
  vatOnPassThrough: boolean;
  timezone: string;
  accountSignature: { image: string; name: string; signedAt: string } | null;
  ceoSignature: { image: string; signedAt: string | null } | null;
}

async function callPublic(body: Record<string, unknown>): Promise<PublicData> {
  const { data, error } = await supabase.functions.invoke('ops-hub/public', { body });
  if (error) {
    let message = 'Không tải được báo giá. Thử lại sau ít phút.';
    const ctx = (error as { context?: Response }).context;
    try {
      const b = await ctx?.json();
      message = b?.error?.message ?? message;
    } catch {
      /* giữ câu mặc định */
    }
    throw new Error(message);
  }
  return data as PublicData;
}

export function PublicQuotePage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'sign' | 'changes'>('view');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const pdf = useRef<HTMLDivElement>(null);

  useEffect(() => {
    callPublic({ token, op: 'view' }).then(setData, (e) => setErr((e as Error).message));
  }, [token]);

  async function submit(op: 'sign' | 'changes') {
    setBusy(true);
    setErr(null);
    try {
      const d = await callPublic({ token, op, name, title, note, signature: sig });
      setData(d);
      setDone(op === 'sign' ? 'Cảm ơn quý khách. Báo giá đã được ký xác nhận, Go Media sẽ liên hệ ngay.' : 'Đã gửi đề nghị điều chỉnh. Người phụ trách của Go Media sẽ phản hồi sớm.');
      setMode('view');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Banner tone="bad" title="Không mở được báo giá">{err}</Banner>
      </div>
    );
  }
  if (!data) return <Loading label="Đang mở báo giá…" />;
  const q = data.quote;
  const tz = data.timezone || 'Asia/Ho_Chi_Minh';
  const signed = !!q.client_signed_at;
  return (
    <div className="min-h-screen bg-canvas px-3 py-6 sm:px-6">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">{data.company.shortName} gửi quý khách</p>
            <h1 className="font-display text-[28px] font-semibold text-ink">Báo giá {q.code}</h1>
            <p className="text-[14px] text-ink-3">Người lập: {data.preparedBy}{q.sent_at ? `, gửi lúc ${fmtVnDateTime(q.sent_at, tz)}` : ''}</p>
          </div>
          <Button variant="secondary" icon="download" onClick={() => pdf.current && downloadQuotePdf(pdf.current, q.code)}>
            Tải PDF
          </Button>
        </header>

        {done && <Banner tone="ok" title="Đã ghi nhận">{done}</Banner>}
        {err && <Banner tone="bad" title="Chưa gửi được">{err}</Banner>}
        {signed ? (
          <Banner tone="ok" title="Báo giá đã được ký xác nhận">
            {q.client_signer_name} ký lúc {fmtVnDateTime(q.client_signed_at!, tz)}. Báo giá đã đủ chữ ký người lập, đại diện Go Media và khách hàng.
          </Banner>
        ) : (
          mode === 'view' && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper p-4">
              <p className="mr-auto text-[14.5px] text-ink-2">Quý khách xem báo giá bên dưới, rồi ký xác nhận hoặc gửi đề nghị điều chỉnh.</p>
              <Button variant="secondary" icon="message" onClick={() => setMode('changes')}>
                Đề nghị điều chỉnh
              </Button>
              <Button icon="check" onClick={() => setMode('sign')}>
                Ký xác nhận
              </Button>
            </div>
          )
        )}
        {q.client_note && !signed && mode === 'view' && <Banner tone="warn" title="Đề nghị quý khách đã gửi">“{q.client_note}”</Banner>}

        {mode !== 'view' && !signed && (
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4">
            <h2 className="text-[17px] font-semibold text-ink">{mode === 'sign' ? 'Ký xác nhận báo giá' : 'Đề nghị điều chỉnh'}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Họ tên người đại diện">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              {mode === 'sign' && <Field label="Chức vụ (không bắt buộc)">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>}
            </div>
            <Field label={mode === 'sign' ? 'Ghi chú (không bắt buộc)' : 'Nội dung cần điều chỉnh'}>
              {(id) => <textarea id={id} rows={3} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px]" value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {mode === 'sign' &&
              (sig ? (
                <div className="flex flex-wrap items-center gap-3">
                  <img src={sig} alt="Chữ ký" className="max-h-20 rounded border border-line bg-white p-1" />
                  <Button variant="ghost" onClick={() => setSig(null)}>
                    Ký lại
                  </Button>
                </div>
              ) : (
                <DrawPad onDone={setSig} onCancel={() => setMode('view')} />
              ))}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setMode('view')}>
                Quay lại
              </Button>
              <Button busy={busy} disabled={!name.trim() || (mode === 'sign' ? !sig : !note.trim())} onClick={() => submit(mode)}>
                {mode === 'sign' ? 'Ký xác nhận' : 'Gửi đề nghị'}
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-line bg-white p-3">
          <div className="mx-auto w-[190mm]">
            <QuotePdf
              ref={pdf}
              quote={q}
              lines={data.lines}
              company={data.company}
              preparedBy={data.preparedBy}
              tz={tz}
              vatOnPassThrough={data.vatOnPassThrough}
              signature={data.ceoSignature}
              accountSignature={data.accountSignature}
              clientSignature={q.client_signed_at && q.client_signature ? { image: q.client_signature, name: q.client_signer_name ?? '', title: q.client_signer_title, signedAt: q.client_signed_at } : null}
            />
          </div>
        </div>
        <p className="text-center text-[12.5px] text-ink-3">Link này chỉ để xem và ký. Quý khách không sửa được nội dung báo giá.</p>
      </div>
    </div>
  );
}
