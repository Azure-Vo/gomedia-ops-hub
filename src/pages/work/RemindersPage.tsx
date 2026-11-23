import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Loading, PageHeader, Select, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { loadMessages } from './data';
import { MessageHistory } from './parts';

/**
 * 1.7 · "Nhắc việc" for PM and CEO: what the bot sent for every project, read-only. The Lark keys, mode,
 * account links and reminder milestones stay on the Admin page; the CEO may change when the summaries go out.
 */
export function RemindersPage() {
  const me = useProfile();
  const [project, setProject] = useState('');
  const history = useAsync(() => loadMessages({ limit: 400 }), []);
  const projects = useAsync(async () => {
    const { data, error } = await supabase.from('lark_tasks').select('id, code, name').eq('kind', 'parent').is('deleted_at', null).order('code');
    if (error) throw error;
    return (data ?? []) as { id: string; code: string; name: string }[];
  }, []);
  const messages = (history.data ?? []).filter((m) => !project || m.project_id === project);
  return (
    <div>
      <PageHeader title="Nhắc việc" subtitle="Tin bot đã gửi cho các dự án. Kết nối Lark và mốc nhắc do Admin cài đặt." />
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Schedule canEdit={me.role === 'ceo' || me.role === 'admin'} />
        <Card title="Bot nhắc khi nào">
          <ul className="flex flex-col gap-2 text-[14px] text-ink-2">
            <li>
              <b className="text-ink">Task ngắn</b> (≤ 3 ngày): nhắc đúng ngày hạn.
            </li>
            <li>
              <b className="text-ink">Task vừa</b> (4 đến 7 ngày): hỏi tiến độ ở 50%, nhắc trước hạn 1 ngày và đúng ngày hạn.
            </li>
            <li>
              <b className="text-ink">Task dài</b> (≥ 8 ngày): hỏi tiến độ ở 50% và 75%, nhắc trước hạn 2 ngày, 1 ngày và đúng ngày hạn.
            </li>
            <li>
              <b className="text-ink">Quá hạn</b>: nhắc mỗi ngày làm việc đến khi nộp.
            </li>
          </ul>
        </Card>
      </div>
      <Card
        title="Lịch sử nhắc việc"
        subtitle="Tin mới nhất ở trên."
        actions={
          <Select aria-label="Lọc theo dự án" className="w-64" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Tất cả dự án</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </Select>
        }
      >
        {history.loading ? <Loading rows={5} /> : <MessageHistory messages={messages} />}
      </Card>
    </div>
  );
}

function Schedule({ canEdit }: { canEdit: boolean }) {
  const { settings, reload } = useSettings();
  const toast = useToast();
  const [f, setF] = useState({ morning: '08:30', evening: '17:30', on: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings) setF({ morning: settings.summary_morning_time ?? '08:30', evening: settings.summary_evening_time ?? '17:30', on: settings.summary_evening_on !== false });
  }, [settings]);
  const changed = !!settings && (f.morning !== (settings.summary_morning_time ?? '08:30') || f.evening !== (settings.summary_evening_time ?? '17:30') || f.on !== (settings.summary_evening_on !== false));
  if (!canEdit) {
    return (
      <Card title="Giờ gửi bản tóm tắt" subtitle="Gửi cho PM vào ngày làm việc. CEO đổi được giờ gửi.">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-[13px] text-ink-3">Tóm tắt sáng</dt>
            <dd className="mt-0.5 text-[24px] font-semibold text-ink">{f.morning}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink-3">Tổng kết cuối ngày</dt>
            <dd className="mt-0.5 text-[24px] font-semibold text-ink">{f.on ? f.evening : <Badge>Đang tắt</Badge>}</dd>
          </div>
        </dl>
      </Card>
    );
  }
  return (
    <Card title="Giờ gửi bản tóm tắt" subtitle="Gửi cho PM vào ngày làm việc.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tóm tắt sáng">{(id) => <Input id={id} type="time" value={f.morning} onChange={(e) => setF({ ...f, morning: e.target.value })} />}</Field>
        <Field label="Tổng kết cuối ngày" hint={f.on ? undefined : 'Đang tắt'}>
          {(id) => <Input id={id} type="time" disabled={!f.on} value={f.evening} onChange={(e) => setF({ ...f, evening: e.target.value })} />}
        </Field>
      </div>
      <label className="mt-3 flex min-h-[40px] items-center gap-2 text-[14px] text-ink-2">
        <input type="checkbox" className="h-5 w-5" checked={f.on} onChange={(e) => setF({ ...f, on: e.target.checked })} />
        Gửi tổng kết cuối ngày cho PM
      </label>
      <Button
        className="mt-3"
        busy={busy}
        disabled={!changed}
        onClick={() => {
          setBusy(true);
          callApi('work.summary_schedule', { summary_morning_time: f.morning, summary_evening_time: f.evening, summary_evening_on: f.on })
            .then(() => (toast('Đã lưu giờ gửi'), reload()), (e) => toast((e as Error).message, 'bad'))
            .finally(() => setBusy(false));
        }}
      >
        Lưu giờ gửi
      </Button>
    </Card>
  );
}
