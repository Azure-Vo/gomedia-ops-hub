// 1.8 · Ba chữ ký trên báo giá (Account → CEO → Khách), link công khai cho khách, và tin bot Lark của báo giá.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, cx, Icon, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnDateTime } from '@/lib/format';
import { check, supabase } from '@/lib/supabase';
import { BotCard } from '../lark/BotCard';
import type { BotMessageRow } from '../work/data';
import { MSG_COLS } from '../work/data';
import { loadUserSignature } from './data';

export interface SignState {
  account_signed_at: string | null;
  account_signed_by: string | null;
  client_token: string | null;
  client_viewed_at: string | null;
  client_signed_at: string | null;
  client_signer_name: string | null;
  client_signer_title: string | null;
  client_signature: string | null;
  client_note: string | null;
  accountImage: string | null;
}

const SIGN_COLS = 'account_signed_at, account_signed_by, client_token, client_viewed_at, client_signed_at, client_signer_name, client_signer_title, client_signature, client_note';

/** Trạng thái ký của một báo giá; tự tải lại khi `version` đổi (sau mỗi thao tác). */
export function useSignState(quoteId: string, version: unknown) {
  const [data, setData] = useState<SignState | null>(null);
  const load = useCallback(async () => {
    const r = await supabase.from('quotes').select(SIGN_COLS).eq('id', quoteId).maybeSingle();
    if (r.error || !r.data) return setData(null);
    const row = r.data as Omit<SignState, 'accountImage'>;
    setData({ ...row, accountImage: await loadUserSignature(row.account_signed_by) });
  }, [quoteId]);
  useEffect(() => {
    void load();
  }, [load, version]);
  return { data, reload: load };
}

function Step({ n, title, done, when, children }: { n: number; title: string; done: boolean; when?: string | null; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold', done ? 'bg-ok text-white' : 'border border-line-edge text-ink-3')}>
        {done ? <Icon name="check" size={14} /> : n}
      </span>
      <div className="min-w-0">
        <div className="text-[14.5px] font-semibold text-ink">{title}</div>
        {when && <div className="text-[13px] text-ink-3">{when}</div>}
        {children}
      </div>
    </li>
  );
}

export function SignatureTrail({
  quote,
  sign,
  accountName,
  ceoSigned,
  canShare,
  isOwner = false,
  myImage = null,
  tz,
  onChanged,
}: {
  isOwner?: boolean;
  myImage?: string | null;
  quote: { id: string; status: string; signed_at: string | null; kind: string; approver: string | null };
  sign: SignState | null;
  accountName: string;
  ceoSigned: boolean;
  canShare: boolean;
  tz: string;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const sent = quote.status === 'sent';
  async function copyLink() {
    setBusy(true);
    try {
      const r = await callApi<{ url: string | null; token: string }>('quote.client_link', { quote_id: quote.id });
      const url = r.url ?? `${window.location.origin}${import.meta.env.BASE_URL}k/${r.token}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast('Đã sao chép link cho khách');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  const quickNoSign = quote.kind === 'quick' && !quote.approver;
  return (
    <Card title="Ba chữ ký trên báo giá" subtitle="Người lập ký khi gửi duyệt, CEO ký khi duyệt, khách ký qua link công khai." info="Mỗi mốc ký đều được ghi giờ để đo hành trình báo giá, và báo vào nhóm Lark.">
      <ol className="flex flex-col gap-3">
        <Step n={1} title={`Người lập: ${accountName}`} done={!!sign?.account_signed_at} when={sign?.account_signed_at ? `Đã ký ${fmtVnDateTime(sign.account_signed_at, tz)}` : 'Ký khi gửi duyệt (hoặc khi gửi thẳng cho khách)'}>
          {sign?.accountImage && sign.account_signed_at && <img src={sign.accountImage} alt="Chữ ký người lập" className="mt-1 max-h-12" />}
          {isOwner && !myImage && (
            <Link to="/profile" className="mt-0.5 inline-block text-[13px] font-semibold text-brand underline-offset-2 hover:underline">
              Vẽ chữ ký của bạn ở Hồ sơ để in lên PDF
            </Link>
          )}
        </Step>
        <Step
          n={2}
          title="CEO (đại diện Go Media)"
          done={ceoSigned}
          when={quote.signed_at ? `Đã ký ${fmtVnDateTime(quote.signed_at, tz)}` : quickNoSign && sent ? 'Báo giá nhanh trong khung giá: in sẵn chữ ký CEO' : 'Ký sau khi duyệt'}
        />
        <Step
          n={3}
          title="Khách hàng"
          done={!!sign?.client_signed_at}
          when={
            sign?.client_signed_at
              ? `${sign.client_signer_name ?? ''} đã ký ${fmtVnDateTime(sign.client_signed_at, tz)}`
              : sign?.client_viewed_at
                ? `Khách đã mở link lúc ${fmtVnDateTime(sign.client_viewed_at, tz)}, chưa ký`
                : sent
                  ? 'Gửi link cho khách để xem và ký'
                  : 'Sau khi gửi khách'
          }
        >
          {sign?.client_signature && <img src={sign.client_signature} alt="Chữ ký khách" className="mt-1 max-h-12" />}
          {sign?.client_note && !sign.client_signed_at && (
            <div className="mt-1 rounded-lg border border-bad-line bg-bad-soft px-2.5 py-1.5 text-[13.5px] text-bad">Khách đề nghị: “{sign.client_note}”</div>
          )}
        </Step>
      </ol>
      {sent && canShare && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon="link" busy={busy} onClick={copyLink}>
            {sign?.client_token ? 'Sao chép lại link cho khách' : 'Tạo link cho khách'}
          </Button>
          {sign?.client_token && (
            <a className="text-[13.5px] font-semibold text-brand underline-offset-2 hover:underline" href={`${import.meta.env.BASE_URL}k/${sign.client_token}`} target="_blank" rel="noopener">
              Mở trang khách
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

/** Tin bot Lark của một báo giá (mới nhất trước). */
export function QuoteBotHistory({ quoteId, version }: { quoteId: string; version: unknown }) {
  const [rows, setRows] = useState<BotMessageRow[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = check(await supabase.from('bot_messages').select(MSG_COLS).eq('quote_id', quoteId).order('created_at', { ascending: false }).limit(20)) as BotMessageRow[];
        if (live) setRows(r);
      } catch {
        /* chưa nâng cấp DB: bỏ qua */
      }
    })();
    return () => {
      live = false;
    };
  }, [quoteId, version]);
  if (!rows.length) return null;
  return (
    <Card title="Tin bot gửi vào nhóm Lark" subtitle="Mỗi mốc của báo giá: gửi duyệt, góp ý, yêu cầu sửa, ký, gửi khách, khách ký.">
      <div className="flex flex-col gap-3">
        {rows.map((m) => (
          <BotCard
            key={m.id}
            message={m.message}
            botName="GO MEDIA Quote Bot"
            time={fmtVnDateTime(m.sent_at ?? m.created_at, 'Asia/Ho_Chi_Minh')}
            footer={m.status === 'sent' ? <Badge tone="ok">Đã gửi lên Lark</Badge> : m.status === 'failed' ? <Badge tone="bad">Lỗi gửi: {m.last_error}</Badge> : <Badge>Mô phỏng</Badge>}
          />
        ))}
      </div>
    </Card>
  );
}
