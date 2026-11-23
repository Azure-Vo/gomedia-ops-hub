import { useEffect, useState } from 'react';
import { checkChildCode, checkParentCode, parentCodeOf, validateCodeRules } from '@/domain';
import { Badge, Banner, Button, Card, Field, Input, Loading, PageHeader, Select, useAsync, useToast, PageSkeleton } from '@/components/ui';
import { callApi } from '@/lib/api';
import { check, supabase } from '@/lib/supabase';
import { useSettings } from '@/lib/settings';
import { loadMessages } from '../work/data';
import { MessageHistory } from '../work/parts';

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
  const history = useAsync(() => loadMessages({ limit: 150 }), []);
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
    summary_morning_time: '08:30',
    summary_evening_time: '17:30',
    summary_evening_on: true,
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
      summary_morning_time: settings.summary_morning_time ?? '08:30',
      summary_evening_time: settings.summary_evening_time ?? '17:30',
      summary_evening_on: settings.summary_evening_on !== false,
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
  // 1.6: each project uses its own Lark group, so the shared chat_id is only a fallback for projects created before 1.6.
  const missing = goingLive ? [!f.lark_app_id && 'App ID', !(status?.hasAppSecret || secret) && 'App Secret', !(status?.hasVerificationToken || vtoken) && 'Verification Token'].filter(Boolean) : [];

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
  async function runNow() {
    setBusy('run');
    try {
      const r = await callApi<{ reminders: number; checkins?: number; summaries?: number; nudges?: number; fromLark?: number; failed: number; note?: string }>('lark.run');
      toast(r.note ?? `Đã chạy: ${r.reminders} nhắc hạn, ${r.checkins ?? 0} hỏi tiến độ, ${r.nudges ?? 0} nhắc duyệt, ${r.summaries ?? 0} tóm tắt${r.failed ? `, ${r.failed} lỗi gửi` : ''}.`);
      history.reload();
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

  if (loading || !settings) return <PageSkeleton kind="form" />;
  return (
    <div>
      <PageHeader title="Kết nối Lark & nhắc việc" subtitle="Bot Lark của Go Media."
        info="Custom App + bot. Secret lưu trong Supabase Vault, không hiện lại trên web." />
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

          <Card title="Lark App" subtitle="Lấy ở Lark Developer Console."
            info="App của bạn → Credentials & Basic Info, và Events & Callbacks.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Máy chủ Lark">
                {(id) => (
                  <Select id={id} value={f.lark_api_base} onChange={(e) => setF({ ...f, lark_api_base: e.target.value })}>
                    <option value="https://open.larksuite.com">Lark (quốc tế): open.larksuite.com</option>
                    <option value="https://open.feishu.cn">Feishu (Trung Quốc): open.feishu.cn</option>
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
              <Field label="chat_id group chung (chỉ cho dự án tạo trước bản 1.6)" hint="Có thể để trống" className="sm:col-span-2">
                {(id) => <Input id={id} value={f.lark_chat_id} placeholder="oc_…" onChange={(e) => setF({ ...f, lark_chat_id: e.target.value.trim() })} />}
              </Field>
            </div>
            <div className="mt-3 rounded-lg bg-canvas p-3 text-[13.5px]">
              <b>Request URL</b> (dán vào Events & Callbacks, cả mục Event và Callback):
              <code className="mt-1 block break-all font-mono text-[12.5px]">{status?.eventsUrl}</code>
            </div>
          </Card>

          <Card title="Lịch nhắc và tóm tắt" subtitle="Mốc nhắc tự chọn theo độ dài task."
            info={
              <ul className="flex flex-col gap-1">
                <li><b>Ngắn</b> (≤ 3 ngày): nhắc D0.</li>
                <li><b>Vừa</b> (4–7 ngày): hỏi tiến độ 50%, nhắc D-1, D0.</li>
                <li><b>Dài</b> (≥ 8 ngày): hỏi 50%, 75%, nhắc D-2, D-1, D0.</li>
                <li>Quá hạn: nhắc mỗi ngày.</li>
              </ul>
            }>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Giờ nhắc hạn và hỏi tiến độ" hint="Mặc định 09:00">
                {(id) => <Input id={id} type="time" value={f.lark_notify_time} onChange={(e) => setF({ ...f, lark_notify_time: e.target.value })} />}
              </Field>
              <Field label="Tóm tắt sáng cho PM" hint="Ngày làm việc">
                {(id) => <Input id={id} type="time" value={f.summary_morning_time} onChange={(e) => setF({ ...f, summary_morning_time: e.target.value })} />}
              </Field>
              <Field label="Tổng kết cuối ngày" hint={f.summary_evening_on ? 'Ngày làm việc' : 'Đang tắt'}>
                {(id) => <Input id={id} type="time" disabled={!f.summary_evening_on} value={f.summary_evening_time} onChange={(e) => setF({ ...f, summary_evening_time: e.target.value })} />}
              </Field>
            </div>
            <label className="mt-3 flex min-h-[40px] items-center gap-2 text-[14px] text-ink-2">
              <input type="checkbox" className="h-5 w-5" checked={f.summary_evening_on} onChange={(e) => setF({ ...f, summary_evening_on: e.target.checked })} />
              Gửi tổng kết cuối ngày cho PM
            </label>
          </Card>

          <Card title="Quy chuẩn mã (bản 1.5)" subtitle="Chỉ dùng để đọc task cũ."
            info="Từ 1.6, PM nhập mã dự án (VD MT35), hệ thống tự sinh mã task (MT35-01).">
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
            <p className="mt-2 text-[13px] text-ink-3">Suy từ ví dụ DA056 / DA056-04-S44 trong brief.</p>
          </Card>

          <div className="flex gap-2">
            <Button busy={busy === 'save'} disabled={ruleErrors.length > 0} onClick={save}>
              Lưu cấu hình
            </Button>
            <Button variant="secondary" busy={busy === 'test'} onClick={test} disabled={settings.lark_mode !== 'live' || !settings.lark_chat_id}>
              Gửi tin thử vào group chung
            </Button>
            <Button variant="secondary" icon="refresh" busy={busy === 'run'} onClick={runNow}>
              Chạy nhắc việc ngay (kiểm thử)
            </Button>
          </div>
          <p className="text-[13px] text-ink-3">
            Tự chạy 15 phút/lần. “Chạy ngay” dùng để thử; mỗi tin chỉ gửi 1 lần/ngày.
          </p>

          {settings.lark_mode === 'live' && <PeopleLinks />}

          <Card title="Lịch sử nhắc việc (tất cả dự án)">{history.loading ? <Loading /> : <MessageHistory messages={history.data ?? []} />}</Card>
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
              <b>Permissions & Scopes</b>, thêm quyền: đọc, tạo và sửa task (Task v2), gửi tin nhắn với tư cách bot (cả tin riêng cho người dùng), đọc tin nhắn gửi cho bot, xem danh sách group của bot và thành viên group, đọc ID người dùng. Tên quyền cụ thể đối chiếu trong console.
            </li>
            <li>
              <b>Events & Callbacks</b>: để trống Encrypt Key; chép <b>Verification Token</b>; dán Request URL ở trên; thêm event <code>im.message.receive_v1</code> và callback <code>card.action.trigger</code>.
            </li>
            <li>
              <b>Version Management & Release</b>: tạo bản phát hành; quản trị viên Lark của Go Media duyệt.
            </li>
            <li>
              Thêm bot vào <b>group của từng dự án</b> (nên đặt tên group bắt đầu bằng mã dự án, VD “MT35 - Tên dự án”). PM chọn group khi tạo dự án; nếu bot chưa có trong group, trang dự án sẽ báo.
            </li>
            <li>
              Chọn “Kết nối Lark thật” → Lưu → <b>Gửi tin thử vào group</b>.
            </li>
          </ol>
          <Banner tone="info" className="mt-4">
            Mới thử với Lark giả lập. Lần đầu nối Lark thật: gõ /taomoi duan trong group dự án, rồi xem Lịch sử nhắc việc.
          </Banner>
        </Card>
      </div>
    </div>
  );
}

/** Live mode: which Lark account belongs to which Ops Hub user (needed for @tags, direct messages and the PM check). */
function PeopleLinks() {
  const toast = useToast();
  const data = useAsync(async () => {
    const [people, profiles] = await Promise.all([
      supabase.from('lark_people').select('open_id, name, profile_id').not('open_id', 'like', 'sim:%').order('name'),
      supabase.from('profiles').select('id, full_name, email, role, active').order('full_name'),
    ]);
    return { people: check(people) as { open_id: string; name: string; profile_id: string | null }[], profiles: check(profiles) as { id: string; full_name: string; email: string; role: string; active: boolean }[] };
  }, []);
  if (data.loading || !data.data) return <Loading />;
  const { people, profiles } = data.data;
  return (
    <Card title="Liên kết tài khoản Lark" subtitle="Gán người trên Lark với tài khoản Ops Hub."
      info="Bot biết người qua thành viên group và @tag. Có liên kết thì bot @tag đúng người, nhắn riêng được và nhận ra PM.">
      {!people.length ? (
        <p className="text-[14px] text-ink-3">Chưa có ai. Thêm bot vào group dự án để cập nhật.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {people.map((p) => (
            <li key={p.open_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div>
                <div className="font-medium text-ink">{p.name || '—'}</div>
                <div className="font-mono text-[12px] text-ink-3">{p.open_id}</div>
              </div>
              <Select
                className="w-64"
                value={p.profile_id ?? ''}
                onChange={(e) =>
                  callApi('lark.link_person', { open_id: p.open_id, profile_id: e.target.value || null }).then(
                    () => (toast('Đã liên kết'), data.reload()),
                    (err) => toast(err.message, 'bad'),
                  )
                }
              >
                <option value="">Chưa liên kết</option>
                {profiles
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.email} ({u.role})
                    </option>
                  ))}
              </Select>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
