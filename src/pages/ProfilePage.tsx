import { useState } from 'react';
import { ROLE_LABEL } from '@/domain';
import { Badge, Banner, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnDateTime } from '@/lib/format';
import { useProfile, useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';

interface TgStatus {
  linked: boolean;
  code: string | null;
  expires_at: string | null;
}

export function ProfilePage() {
  const me = useProfile();
  const { refreshProfile } = useSession();
  const { settings, tz } = useSettings();
  const toast = useToast();
  const [name, setName] = useState(me.full_name);
  const [busy, setBusy] = useState<string | null>(null);
  const tg = useAsync(async () => check(await supabase.rpc('my_telegram')) as TgStatus, []);
  const bot = settings?.telegram_bot_username;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  const status = tg.data;
  const link = status?.code && bot ? `https://t.me/${bot}?start=${status.code}` : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Hồ sơ & Telegram" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tài khoản">
          <div className="flex flex-col gap-3">
            <div className="text-[15px]">
              <div className="text-ink-3">Email</div>
              <div className="font-semibold">{me.email}</div>
            </div>
            <div className="text-[15px]">
              <div className="text-ink-3">Vai trò</div>
              <Badge tone="brand">{ROLE_LABEL[me.role]}</Badge>
            </div>
            <Field label="Họ tên hiển thị">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <div>
              <Button
                busy={busy === 'name'}
                disabled={!name.trim() || name === me.full_name}
                onClick={() =>
                  run('name', async () => {
                    check(await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', me.id));
                    await refreshProfile();
                    toast('Đã lưu tên');
                  })
                }
              >
                Lưu tên
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Telegram" subtitle="Bot nhắn check-in, cảnh báo và yêu cầu duyệt, chỉ trong giờ làm việc.">
          {tg.loading ? (
            <Loading />
          ) : tg.error ? (
            <ErrorBox error={tg.error} />
          ) : status?.linked ? (
            <div className="flex flex-col gap-3">
              <Banner tone="ok" title="Đã liên kết Telegram">Bạn sẽ nhận tin nhắn từ {bot ? `@${bot}` : 'bot của Go Media'}.</Banner>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon="telegram" busy={busy === 'test'} onClick={() => run('test', async () => { await callApi('system.test_message'); toast('Đã gửi tin nhắn thử'); })}>
                  Gửi tin thử
                </Button>
                <Button variant="ghost" busy={busy === 'unlink'} onClick={() => run('unlink', async () => { check(await supabase.rpc('unlink_telegram')); tg.reload(); toast('Đã huỷ liên kết'); })}>
                  Huỷ liên kết
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {!bot && <Banner tone="warn">Admin chưa kết nối bot (trang Diagnostics). Bạn vẫn lấy mã được, nhưng cần tên bot để mở liên kết.</Banner>}
              <ol className="list-decimal pl-5 text-[15px] text-ink-2">
                <li>Bấm "Lấy mã liên kết".</li>
                <li>Bấm "Mở Telegram" (trên điện thoại hoặc máy tính có Telegram) rồi bấm Start.</li>
                <li>Bot trả lời "Đã liên kết" là xong.</li>
              </ol>
              {status?.code ? (
                <div className="rounded-xl bg-canvas p-4">
                  <div className="text-[13px] text-ink-3">Mã của bạn (hết hạn {status.expires_at ? fmtVnDateTime(status.expires_at, tz) : ''})</div>
                  <div className="mt-1 text-2xl font-extrabold tracking-[0.2em] text-ink">{status.code}</div>
                  {link ? (
                    <a href={link} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-brand px-4 font-semibold text-white">
                      Mở Telegram
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-ink-3">Hoặc mở bot trên Telegram và gửi: /start {status.code}</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="ghost" icon="refresh" onClick={() => tg.reload()}>
                      Đã bấm Start, kiểm tra lại
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button icon="link" busy={busy === 'code'} onClick={() => run('code', async () => { check(await supabase.rpc('new_telegram_link_code')); tg.reload(); })}>
                    Lấy mã liên kết
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
