import { useEffect, useState } from 'react';
import { checkChildCode, checkParentCode, parentCodeOf, validateCodeRules } from '@/domain';
import { Badge, Banner, Button, Card, Field, Input, Loading, PageHeader, Select, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { useSettings } from '@/lib/settings';

interface Status {
  mode: 'simulation' | 'live';
  hasAppSecret: boolean;
  hasVerificationToken: boolean;
  eventsUrl: string;
  rulesErrors: string[];
}

/** Admin: connect the Lark Custom App (brief step 1) and set the code rules and reminder time. */
export function LarkSetupPage() {
  const { settings, reload } = useSettings();
  const toast = useToast();
  const { data: status, loading, reload: reloadStatus } = useAsync(() => callApi<Status>('lark.status'), []);
  const [f, setF] = useState({
    lark_mode: 'simulation',
    lark_api_base: 'https://open.larksuite.com',
    lark_app_id: '',
    lark_chat_id: '',
    lark_notify_time: '09:00',
    lark_notify_d0: false,
    lark_parent_pattern: '',
    lark_child_pattern: '',
    lark_parent_example: '',
    lark_child_example: '',
  });
  const [secret, setSecret] = useState('');
  const [vtoken, setVtoken] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [tryCode, setTryCode] = useState('');

  useEffect(() => {
    if (!settings) return;
    setF({
      lark_mode: settings.lark_mode,
      lark_api_base: settings.lark_api_base,
      lark_app_id: settings.lark_app_id,
      lark_chat_id: settings.lark_chat_id,
      lark_notify_time: settings.lark_notify_time,
      lark_notify_d0: settings.lark_notify_d0,
      lark_parent_pattern: settings.lark_parent_pattern,
      lark_child_pattern: settings.lark_child_pattern,
      lark_parent_example: settings.lark_parent_example,
      lark_child_example: settings.lark_child_example,
    });
  }, [settings]);

  const rules = { parentPattern: f.lark_parent_pattern, childPattern: f.lark_child_pattern, parentExample: f.lark_parent_example, childExample: f.lark_child_example };
  const ruleErrors = f.lark_parent_pattern ? validateCodeRules(rules) : [];
  const tried = tryCode.trim()
    ? tryCode.includes('-')
      ? checkChildCode(tryCode, parentCodeOf(tryCode, rules) ?? '', rules)
      : checkParentCode(tryCode, rules)
    : null;
  const goingLive = f.lark_mode === 'live';
  const missing = goingLive ? [!f.lark_app_id && 'App ID', !(status?.hasAppSecret || secret) && 'App Secret', !(status?.hasVerificationToken || vtoken) && 'Verification Token', !f.lark_chat_id && 'chat_id của group'].filter(Boolean) : [];

  async function save() {
    setBusy('save');
    try {
      await callApi('lark.config', { ...f, app_secret: secret || undefined, verification_token: vtoken || undefined });
      setSecret('');
      setVtoken('');
      await Promise.all([reload(), reloadStatus()]);
      toast('Đã lưu cấu hình Lark');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }
  async function test() {
    setBusy('test');
    try {
      const r = await callApi<{ note: string }>('lark.test');
      toast(r.note);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  if (loading || !settings) return <Loading />;
  return (
    <div>
      <PageHeader title="Kết nối Lark (S1)" subtitle="Custom App + bot trên Lark của Go Media. Secret được lưu trong Supabase Vault, không hiện lại trên web." />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-4">
          <Card title="Chế độ">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['simulation', 'Mô phỏng (chưa gọi Lark)'],
                  ['live', 'Kết nối Lark thật'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  aria-pressed={f.lark_mode === k}
                  onClick={() => setF({ ...f, lark_mode: k })}
                  className={`min-h-[44px] rounded-lg border px-4 text-[14.5px] font-bold ${f.lark_mode === k ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-2'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {missing.length > 0 && (
              <Banner tone="warn" className="mt-3">
                Còn thiếu: {missing.join(', ')}. Khi thiếu, hệ thống không gửi gì lên Lark.
              </Banner>
            )}
          </Card>

          <Card title="Lark App" subtitle="Lấy ở Lark Developer Console → app của bạn → Credentials & Basic Info, và Events & Callbacks.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Máy chủ Lark">
                {(id) => (
                  <Select id={id} value={f.lark_api_base} onChange={(e) => setF({ ...f, lark_api_base: e.target.value })}>
                    <option value="https://open.larksuite.com">Lark (quốc tế) · open.larksuite.com</option>
                    <option value="https://open.feishu.cn">Feishu (Trung Quốc) · open.feishu.cn</option>
                  </Select>
                )}
              </Field>
              <Field label="App ID">{(id) => <Input id={id} value={f.lark_app_id} placeholder="cli_…" onChange={(e) => setF({ ...f, lark_app_id: e.target.value.trim() })} />}</Field>
              <Field label="App Secret" hint={status?.hasAppSecret ? 'Đã lưu. Nhập lại chỉ khi muốn đổi.' : 'Chưa có'}>
                {(id) => <Input id={id} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={status?.hasAppSecret ? '••••••••' : ''} />}
              </Field>
              <Field label="Verification Token" hint={status?.hasVerificationToken ? 'Đã lưu. Để trống Encrypt Key.' : 'Ở mục Events & Callbacks → Encryption Strategy'}>
                {(id) => <Input id={id} type="password" autoComplete="off" value={vtoken} onChange={(e) => setVtoken(e.target.value)} placeholder={status?.hasVerificationToken ? '••••••••' : ''} />}
              </Field>
              <Field label="chat_id của group nhận thông báo" hint="Dạng oc_…; xem hướng dẫn bên phải" className="sm:col-span-2">
                {(id) => <Input id={id} value={f.lark_chat_id} placeholder="oc_…" onChange={(e) => setF({ ...f, lark_chat_id: e.target.value.trim() })} />}
              </Field>
            </div>
            <div className="mt-3 rounded-lg bg-canvas p-3 text-[13.5px]">
              <b>Request URL</b> (dán vào Events & Callbacks, cả mục Event và Callback):
              <code className="mt-1 block break-all font-mono text-[12.5px]">{status?.eventsUrl}</code>
            </div>
          </Card>

          <Card title="Lịch nhắc">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Giờ gửi mỗi ngày" hint="Brief: mặc định 09:00 giờ Việt Nam">
                {(id) => <Input id={id} type="time" value={f.lark_notify_time} onChange={(e) => setF({ ...f, lark_notify_time: e.target.value })} />}
              </Field>
              <label className="flex min-h-[44px] items-center gap-2 self-end text-[14px] text-ink-2">
                <input type="checkbox" className="h-5 w-5" checked={f.lark_notify_d0} onChange={(e) => setF({ ...f, lark_notify_d0: e.target.checked })} />
                Gửi cả ngày deadline (D0)
              </label>
            </div>
            <p className="mt-2 text-[13px] text-ink-3">Brief ghi D0 “Không gửi”, nhưng ảnh minh hoạ của CEO có thẻ D0. Mặc định theo brief (tắt) cho đến khi CEO chốt.</p>
          </Card>

          <Card title="Quy chuẩn mã task" subtitle="Biểu thức chính quy. {PARENT} trong mẫu task con là mã task mẹ, nên task con phải bắt đầu bằng đúng mã task mẹ.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mẫu mã task mẹ">{(id) => <Input id={id} className="font-mono" value={f.lark_parent_pattern} onChange={(e) => setF({ ...f, lark_parent_pattern: e.target.value })} />}</Field>
              <Field label="Ví dụ">{(id) => <Input id={id} className="font-mono" value={f.lark_parent_example} onChange={(e) => setF({ ...f, lark_parent_example: e.target.value })} />}</Field>
              <Field label="Mẫu mã task con">{(id) => <Input id={id} className="font-mono" value={f.lark_child_pattern} onChange={(e) => setF({ ...f, lark_child_pattern: e.target.value })} />}</Field>
              <Field label="Ví dụ">{(id) => <Input id={id} className="font-mono" value={f.lark_child_example} onChange={(e) => setF({ ...f, lark_child_example: e.target.value })} />}</Field>
            </div>
            {ruleErrors.length > 0 && <Banner tone="bad" className="mt-3">{ruleErrors.join(' ')}</Banner>}
            <div className="mt-3 flex items-end gap-2">
              <Field label="Thử một mã" className="flex-1">
                {(id) => <Input id={id} className="font-mono" value={tryCode} placeholder="DA056-04-S44" onChange={(e) => setTryCode(e.target.value)} />}
              </Field>
              {tried && <Badge tone={tried.length ? 'bad' : 'ok'}>{tried.length ? tried[0] : 'Hợp lệ'}</Badge>}
            </div>
            <p className="mt-2 text-[13px] text-ink-3">Mặc định suy từ ví dụ duy nhất trong brief (DA056 / DA056-04-S44). Cần CEO gửi quy chuẩn mã thực tế để chỉnh.</p>
          </Card>

          <div className="flex gap-2">
            <Button busy={busy === 'save'} disabled={ruleErrors.length > 0} onClick={save}>
              Lưu cấu hình
            </Button>
            <Button variant="secondary" busy={busy === 'test'} onClick={test} disabled={settings.lark_mode !== 'live'}>
              Gửi tin thử vào group
            </Button>
          </div>
        </div>

        <Card title="Các bước trên Lark (brief, Bước 1)">
          <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-[14px] leading-relaxed text-ink-2">
            <li>
              Vào <b>Lark Developer Console</b> → Create Custom App (tên ví dụ “GO MEDIA Task Bot”). Chép <b>App ID</b> và <b>App Secret</b> sang bên trái.
            </li>
            <li>
              <b>Add features → Bot</b>: bật bot.
            </li>
            <li>
              <b>Permissions & Scopes</b>, thêm quyền: đọc và tạo task (Task v2), gửi tin nhắn với tư cách bot, đọc tin nhắn gửi cho bot, đọc ID người dùng. Tên quyền cụ thể đối chiếu trong console.
            </li>
            <li>
              <b>Events & Callbacks</b>: để trống Encrypt Key; chép <b>Verification Token</b>; dán Request URL ở trên; thêm event <code>im.message.receive_v1</code> và callback <code>card.action.trigger</code>.
            </li>
            <li>
              <b>Version Management & Release</b>: tạo bản phát hành; quản trị viên Lark của Go Media duyệt.
            </li>
            <li>
              Thêm bot vào group nhận thông báo. Lấy <b>chat_id</b> (oc_…) bằng API Explorer “Get chat list” trong console, dán vào bên trái.
            </li>
            <li>
              Chọn “Kết nối Lark thật” → Lưu → <b>Gửi tin thử vào group</b>.
            </li>
          </ol>
          <Banner tone="info" className="mt-4">
            Chưa kiểm chứng trên Lark thật: tên quyền, dạng card và cách Lark gửi callback mới chỉ thử với Lark giả lập. Lần đầu nối, hãy thử lệnh /taomoi và xem tab Group Lark.
          </Banner>
        </Card>
      </div>
    </div>
  );
}
