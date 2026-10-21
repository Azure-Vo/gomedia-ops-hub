import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Select, Textarea, useAsync, useToast } from '@/components/ui';
import { fmtVnShort, timeAgo } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { ALERT_COLS, AlertRow, CP_COLS, CheckpointRow, MilestoneRow, MS_COLS, TASK_COLS, TaskRow } from './data';
import { AlertBadge } from './parts';

export function AlertsPage() {
  const me = useProfile();
  const { tz } = useSettings();
  const toast = useToast();
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [ack, setAck] = useState<{ alert: AlertRow; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => {
    let q = supabase.from('alerts').select(ALERT_COLS).order('created_at', { ascending: false }).limit(300);
    if (scope === 'open') q = q.is('acknowledged_at', null);
    const alerts = check(await q) as AlertRow[];
    const ids = [...new Set(alerts.map((a) => a.task_id))];
    if (!ids.length) return { alerts, tasks: [] as TaskRow[], ms: [] as MilestoneRow[], cps: [] as CheckpointRow[], names: new Map<string, string>() };
    const [tasks, ms, cps, ppl] = await Promise.all([
      supabase.from('tasks').select(TASK_COLS).in('id', ids),
      supabase.from('milestones').select(MS_COLS).in('task_id', ids).order('idx'),
      supabase.from('checkpoints').select(CP_COLS).in('task_id', ids),
      supabase.from('profiles').select('id, full_name, email'),
    ]);
    const names = new Map((check(ppl) as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
    return { alerts, tasks: check(tasks) as TaskRow[], ms: check(ms) as MilestoneRow[], cps: check(cps) as CheckpointRow[], names };
  }, [scope]);

  const canAck = me.role === 'ecom_exec' || me.role === 'admin';
  const items = useMemo(() => {
    if (!data) return [];
    return data.alerts.map((a) => {
      const t = data.tasks.find((x) => x.id === a.task_id);
      const ms = data.ms.filter((m) => m.task_id === a.task_id);
      const cp = a.checkpoint_id ? data.cps.find((c) => c.id === a.checkpoint_id) : undefined;
      const planned = cp ? [25, 50, 75, 99].indexOf(cp.pct) + 1 : 0;
      const done = ms.filter((m) => m.done_at);
      const pending = ms.filter((m) => !m.done_at && m.idx <= Math.max(planned, done.length + 1));
      return { a, t, done, pending };
    });
  }, [data]);

  async function acknowledge() {
    if (!ack) return;
    setBusy(true);
    try {
      check(await supabase.from('alerts').update({ acknowledged_by: me.id, note: ack.note.trim() || null }).eq('id', ack.alert.id));
      toast('Đã xác nhận cảnh báo');
      setAck(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Cảnh báo" subtitle="Chỉ task chậm, bị chặn, im lặng hoặc trễ hạn mới đến đây. Xác nhận và ghi việc bạn sẽ làm để cả nhóm biết đã có người xử lý." />
      <Card
        title={`${items.length} cảnh báo`}
        actions={
          <Select aria-label="Phạm vi" value={scope} onChange={(e) => setScope(e.target.value as 'open' | 'all')} className="w-52">
            <option value="open">Chưa xác nhận</option>
            <option value="all">Tất cả</option>
          </Select>
        }
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !items.length ? (
          <EmptyState title="Không có cảnh báo nào cần xử lý" />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map(({ a, t, done, pending }) => (
              <li key={a.id} className={`rounded-xl border-[1.5px] p-3.5 ${a.kind === 'at_risk' ? 'border-warn-line bg-[#FFF7E8]' : 'border-bad-line bg-[#FFF5F7]'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <AlertBadge kind={a.kind} />
                    {t ? (
                      <Link to={`/tasks/${t.id}`} className="font-bold text-ink hover:text-brand">
                        {t.name}
                      </Link>
                    ) : (
                      '–'
                    )}
                    <span className="text-[13px] text-ink-3">· {t ? data!.names.get(t.owner_id) : ''}</span>
                  </span>
                  <span className="text-[13px] text-ink-3" title={fmtVnShort(a.created_at, tz)}>
                    {timeAgo(a.created_at)} · deadline {t ? fmtVnShort(t.due_at, tz) : '–'}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-[14px]">
                  <div className="text-ok-ink">
                    <b>Đã xong:</b> {done.length ? done.map((m) => m.label).join(', ') : 'chưa có mốc nào'}
                  </div>
                  {a.kind !== 'overdue' && (
                    <div className="text-warn">
                      <b>Đang chờ:</b> {pending.length ? pending.map((m) => m.label).join(', ') : '–'}
                    </div>
                  )}
                  {a.reason && (
                    <div className="text-bad">
                      <b>{a.kind === 'blocker' ? 'Lý do:' : 'Ghi chú:'}</b> {a.reason}
                    </div>
                  )}
                  {t?.priority_note && a.kind !== 'overdue' && (
                    <div className="text-ink">
                      <b>Ưu tiên:</b> {t.priority_note}
                    </div>
                  )}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  {a.acknowledged_at ? (
                    <span className="text-[13.5px] font-semibold text-ok-ink">
                      Đã xử lý bởi {data!.names.get(a.acknowledged_by ?? '') ?? '–'} · {fmtVnShort(a.acknowledged_at, tz)}
                      {a.note ? ` · ${a.note}` : ''}
                    </span>
                  ) : (
                    <span className="text-[13px] text-ink-3">{a.notified_at ? 'Đã gửi Telegram' : 'Sẽ gửi Telegram trong giờ làm việc'}</span>
                  )}
                  {canAck && !a.acknowledged_at && (
                    <Button size="sm" onClick={() => setAck({ alert: a, note: '' })}>
                      Xác nhận & ghi việc sẽ làm
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal
        open={!!ack}
        onClose={() => setAck(null)}
        title="Xác nhận cảnh báo"
        footer={
          <Button busy={busy} onClick={acknowledge}>
            Xác nhận
          </Button>
        }
      >
        <Field label="Bạn sẽ làm gì? (nên ghi)" hint="Ví dụ: đã gọi khách xin ảnh, chuyển KOC dự phòng">
          {(id) => <Textarea id={id} value={ack?.note ?? ''} onChange={(e) => setAck((x) => (x ? { ...x, note: e.target.value } : x))} />}
        </Field>
      </Modal>
    </div>
  );
}
