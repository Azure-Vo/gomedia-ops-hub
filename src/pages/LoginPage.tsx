import { FormEvent, useEffect, useState } from 'react';
import { Banner, Button, Field, Input } from '@/components/ui';
import { supabase } from '@/lib/supabase';

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
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-base font-extrabold text-white">GO</div>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-wide text-accent">Go Media</div>
            <h1 className="text-2xl font-extrabold text-ink">Ops Hub</h1>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">
          {step === 'email' ? (
            <form onSubmit={sendLink} className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-bold text-ink">Đăng nhập bằng email công việc</h2>
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
                <h2 className="text-lg font-bold text-ink">Kiểm tra hộp thư</h2>
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
                <button type="button" className="min-h-[44px] font-semibold text-brand" onClick={() => setStep('email')}>
                  Đổi email
                </button>
                <button type="button" className="min-h-[44px] font-semibold text-brand" onClick={() => sendLink()}>
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
