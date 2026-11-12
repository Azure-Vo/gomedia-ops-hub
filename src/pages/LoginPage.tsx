import { FormEvent, useEffect, useState } from 'react';
import { Banner, Button, Field, Input } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export const RETURN_KEY = 'ops-hub-return-to';

/** The page to go back to after signing in, if it was stored in the last 30 minutes. Reading it clears it. */
export function takeReturnPath(): string | null {
  try {
    const raw = localStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    localStorage.removeItem(RETURN_KEY);
    const v = JSON.parse(raw) as { path?: string; at?: number };
    if (typeof v.path !== 'string' || !v.path.startsWith('/') || v.path.startsWith('//')) return null;
    if (!(Date.now() - Number(v.at) < 30 * 60_000)) return null;
    return v.path;
  } catch {
    return null;
  }
}

function friendly(msg: string): string {
  if (/signups not allowed|otp_disabled|user not found/i.test(msg)) return 'Email này chưa được Admin mời vào app. Nhờ Admin thêm bạn ở trang Người dùng.';
  if (/only request this after|rate limit|too many/i.test(msg)) return 'Bạn vừa yêu cầu email. Đợi khoảng 1 phút rồi thử lại.';
  if (/error sending|smtp|email address not authorized/i.test(msg)) return 'Supabase chưa gửi được email. Admin cần kiểm tra cài đặt SMTP riêng (tab Hướng dẫn triển khai, Bước A5).';
  if (/expired|invalid/i.test(msg)) return 'Mã không đúng hoặc đã hết hạn. Gửi lại email để lấy mã mới.';
  return msg;
}

export function LoginPage() {
  const [email, setEmail] = useState(() => localStorage.getItem('ops-hub-last-email') ?? '');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Errors from an expired magic link arrive in the URL hash.
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const desc = h.get('error_description');
    if (desc) {
      setError(friendly(desc.replace(/\+/g, ' ')));
      history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function sendLink(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const clean = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    localStorage.setItem('ops-hub-last-email', clean);
    // The emailed link opens the app root: remember the page this person was sent to (e.g. a quote link).
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const path = window.location.pathname.slice(base.length) || '/';
    if (path !== '/') localStorage.setItem(RETURN_KEY, JSON.stringify({ path: path + window.location.search, at: Date.now() }));
    setStep('code');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(friendly(error.message));
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(380px,5fr)_7fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-rail px-12 py-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white">
            <img src={`${import.meta.env.BASE_URL}brand/gomedia-mark.png`} alt="" width={32} height={32} className="h-8 w-8" />
          </span>
          <span className="text-[15px] text-rail-text">Go Media</span>
        </div>
        <div className="max-w-sm">
          <p className="text-[44px] font-semibold leading-[1.05] tracking-[-0.03em]">Ops Hub</p>
          <dl className="mt-10 flex flex-col border-t border-white/15 text-[14.5px]">
            <div className="flex gap-4 border-b border-white/15 py-3.5">
              <dt className="w-8 shrink-0 font-semibold text-white">S2</dt>
              <dd className="text-rail-text">Báo giá theo Thư viện giá, kiểm tra khung giá, góp ý ngay trên từng dòng.</dd>
            </div>
            <div className="flex gap-4 border-b border-white/15 py-3.5">
              <dt className="w-8 shrink-0 font-semibold text-white">S1</dt>
              <dd className="text-rail-text">Nhắc task trên Lark và ghi nhận nhân viên hằng tháng với Go Star.</dd>
            </div>
          </dl>
        </div>
        <p className="text-[13px] text-rail-group">Thời gian tính bằng giờ làm việc của Go Media.</p>
      </aside>
      <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-6 px-4 py-16">
        <div className="flex flex-col items-start gap-3 lg:hidden">
          <img src={`${import.meta.env.BASE_URL}brand/gomedia-logo.png`} alt="Go Media" width={526} height={200} className="h-14 w-auto" />
        </div>
        <h1 className="sr-only">Ops Hub</h1>
        <div className="rounded-xl border border-line bg-white p-7 shadow-sheet">
          {step === 'email' ? (
            <form onSubmit={sendLink} className="flex flex-col gap-4">
              <div>
                <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Đăng nhập bằng email công việc</h2>
                <p className="mt-1 text-sm text-ink-3">App gửi cho bạn một email có link đăng nhập và mã 6 số. Không cần mật khẩu.</p>
              </div>
              <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ten@gomedia.vn" />}</Field>
              {error && <Banner tone="bad">{error}</Banner>}
              <Button type="submit" busy={busy} icon="send" size="lg">
                Gửi email đăng nhập
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="flex flex-col gap-4">
              <div>
                <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Kiểm tra hộp thư</h2>
                <p className="mt-1 text-sm text-ink-3">
                  Đã gửi tới <b className="text-ink">{email}</b>. Bấm link trong email (mở trên máy này), hoặc nhập mã trong email vào đây.
                </p>
              </div>
              <Field label="Mã trong email">
                {(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="text-center text-xl tracking-[0.3em]" />}
              </Field>
              {error && <Banner tone="bad">{error}</Banner>}
              <Button type="submit" busy={busy} size="lg">
                Đăng nhập
              </Button>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <button type="button" className="min-h-[40px] font-medium text-brand underline-offset-[3px] hover:underline" onClick={() => setStep('email')}>
                  Đổi email
                </button>
                <button type="button" className="min-h-[40px] font-medium text-brand underline-offset-[3px] hover:underline" onClick={() => sendLink()}>
                  Gửi lại email
                </button>
              </div>
            </form>
          )}
        </div>
        <p className="text-center text-[13px] text-ink-3">Chỉ tài khoản do Admin mời mới đăng nhập được. Không thấy email? Kiểm tra mục Spam.</p>
      </div>
    </div>
  );
}

export function NotConfiguredPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Banner tone="warn" title="App chưa được cấu hình">
        Mở file <b>config.js</b> trong thư mục web đã tải lên hosting, điền <b>supabaseUrl</b> và <b>supabaseAnonKey</b> của project Supabase (Project Settings → API), lưu rồi tải lại trang.
      </Banner>
    </div>
  );
}
