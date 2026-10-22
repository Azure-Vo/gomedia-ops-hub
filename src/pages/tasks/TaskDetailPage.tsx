import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ANSWER_LABEL, fmtNum, workingHoursBetween } from '@/domain';
import { Badge, Banner, Button, Card, ErrorBox, Field, Icon, Input, Loading, Modal, Textarea, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnDateTime, fmtVnShort } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { liveCheckpoint, loadOwners, loadTasks, loadTypes, TaskRow } from './data';
import { AlertBadge, BlockerModal, MilestonePills, TaskFormModal, TaskStatusBadge } from './parts';

export function TaskDetailPage() {
  const { id = '' } = useParams();
  const me = useProfile();
  const { calendar, tz } = useSettings();
  const toast = useToast();
  const manager = me.role === 'ecom_exec' || me.role === 'admin';
  const [planOpen, setPlanOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [noteEdit, setNoteEdit] = useState<{ name: string; note: string } | null>(null);
  const [blocker, setBlocker] = useState<TaskRow | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => {
    const bundle = await loadTasks({ ids: [id], withAlerts: manager || me.role === 'ceo' || me.role === 'pm' });
    const [owners, types] = await Promise.all([manager ? loadOwners() : Promise.resolve([]), manager ? loadTypes(true) : Promise.resolve([])]);
    const names = new Map((check(await supabase.from('profiles').select('id, full_name, email')) as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
    return { ...bundle, owners, types, names };
  }, [id]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const t = data!.tasks[0];
  if (!t) return <ErrorBox error="Không tìm thấy task hoặc bạn không có quyền xem." />;
  const ms = data!.milestones;
  const cps = data!.checkpoints;
  const alerts = data!.alerts;
  const live = liveCheckpoint(cps);
  const alertText = (a: (typeof alerts)[number]) => {
    if (a.reason) return a.reason;
    const cp = cps.find((c) => c.id === a.checkpoint_id);
    if (a.kind === 'at_risk') return cp ? `Trả lời "Chậm hơn kế hoạch" ở checkpoint ${cp.pct}%` : 'Chậm hơn kế hoạch';
    if (a.kind === 'overdue') return 'Đến deadline chưa xong đủ 4 mốc';
    return '';
  };
  const open = !t.closed_as && t.status !== 'cancelled';
  const started = cps.some((c) => c.sent_at);
  const typeName = data!.types.find((x) => x.id === t.type_id)?.name;

  async function cancel() {
    setBusy(true);
    try {
      await callApi('task.cancel', { task_id: t.id, reason: cancelReason });
      toast('Đã huỷ task. Task huỷ không tính vào KPI.');
      setCancelOpen(false);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!noteEdit) return;
    setBusy(true);
    try {
      check(await supabase.from('tasks').update({ name: noteEdit.name.trim(), priority_note: noteEdit.note.trim() || null }).eq('id', t.id));
      toast('Đã lưu');
      setNoteEdit(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/tasks" className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 hover:bg-white" aria-label="Về danh sách task">
            <Icon name="chevronRight" className="rotate-180" />
          </Link>
          <div className="min-w-0">
            <div className="text-[13px] font-bold uppercase tracking-wide text-accent">Task · S1 Checkpoint</div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold text-ink">
              {t.name} <TaskStatusBadge status={t.status} waiting={!!live} />
              {t.closed_as && <Badge tone={t.closed_as === 'on_time' ? 'ok' : 'bad'}>{t.closed_as === 'on_time' ? 'Đúng hạn' : 'Trễ hạn'}</Badge>}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {manager && open && !started && (
            <Button variant="secondary" icon="edit" onClick={() => setPlanOpen(true)}>
              Sửa kế hoạch
            </Button>
          )}
          {manager && open && (
            <>
              <Button variant="secondary" onClick={() => setNoteEdit({ name: t.name, note: t.priority_note ?? '' })}>
                Sửa tên / ưu tiên
              </Button>
              <Button variant="danger" icon="x" onClick={() => setCancelOpen(true)}>
                Huỷ task
              </Button>
            </>
          )}
          {!manager && open && t.owner_id === me.id && t.status !== 'blocked' && (
            <Button variant="danger" onClick={() => setBlocker(t)}>
              Báo bị chặn ngay
            </Button>
          )}
        </div>
      </div>
      {t.status === 'cancelled' && <Banner tone="info" title="Task đã huỷ">{t.cancel_reason}</Banner>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Thông tin" className="lg:col-span-1">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14.5px]">
            <dt className="text-ink-3">Phụ trách</dt>
            <dd className="font-semibold">{data!.names.get(t.owner_id) ?? '–'}</dd>
            <dt className="text-ink-3">Loại</dt>
            <dd>{typeName ?? '–'}</dd>
            <dt className="text-ink-3">Bắt đầu</dt>
            <dd>{fmtVnDateTime(t.start_at, tz)}</dd>
            <dt className="text-ink-3">Deadline</dt>
            <dd>{fmtVnDateTime(t.due_at, tz)}</dd>
            <dt className="text-ink-3">Tổng thời gian</dt>
            <dd>{fmtNum(workingHoursBetween(t.start_at, t.due_at, calendar), 1)} giờ làm việc</dd>
            <dt className="text-ink-3">Ưu tiên</dt>
            <dd>{t.priority_note ?? '–'}</dd>
            {t.closed_at && (
              <>
                <dt className="text-ink-3">Chốt lúc</dt>
                <dd>{fmtVnDateTime(t.closed_at, tz)}</dd>
              </>
            )}
          </dl>
        </Card>
        <Card title="4 mốc kiểm chứng" className="lg:col-span-2">
          <MilestonePills milestones={ms} checkpoints={cps} />
          <ol className="mt-4 flex flex-col gap-2">
            {ms.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2">
                <span>
                  <b>Mốc {m.idx}:</b> {m.label}
                </span>
                <span className="text-[13px] text-ink-3">
                  {m.done_at ? `Xong ${fmtVnShort(m.done_at, tz)}` : 'Chưa xong'}
                  {m.evidence_url && (
                    <>
                      {' · '}
                      <a href={m.evidence_url} target="_blank" rel="noreferrer" className="font-semibold text-brand underline">
                        bằng chứng
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <Card title="Checkpoint" subtitle="Bot hỏi ở 25/50/75/99% thời gian làm việc; không nhắn ngoài giờ làm.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[14.5px]">
            <thead className="text-[13px] text-ink-3">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-semibold">Mốc</th>
                <th className="py-2 pr-3 font-semibold">Lịch</th>
                <th className="py-2 pr-3 font-semibold">Đã gửi</th>
                <th className="py-2 pr-3 font-semibold">Trả lời</th>
                <th className="py-2 font-semibold">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {cps.map((c) => (
                <tr key={c.id} className="border-b border-line-soft">
                  <td className="py-2 pr-3 font-semibold">{c.pct}%</td>
                  <td className="py-2 pr-3">{fmtVnShort(c.scheduled_at, tz)}</td>
                  <td className="py-2 pr-3">{c.sent_at ? `${fmtVnShort(c.sent_at, tz)} · ${c.sent_via === 'telegram' ? 'Telegram' : 'web'}` : '–'}</td>
                  <td className="py-2 pr-3">
                    {c.answer ? (
                      <span>
                        <b>{ANSWER_LABEL[c.answer]}</b> · {fmtVnShort(c.answered_at as string, tz)} · {c.answer_via === 'telegram' ? 'Telegram' : 'web'}
                      </span>
                    ) : c.expired_at && c.sent_at ? (
                      <Badge tone="bad">Không trả lời</Badge>
                    ) : c.sent_at ? (
                      <Badge tone="brand">Đang chờ</Badge>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="py-2 text-ink-2">{c.answer_reason ?? (c.no_reply_alerted_at ? 'Đã cảnh báo không trả lời' : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {(manager || me.role === 'ceo' || me.role === 'pm') && (
        <Card title="Cảnh báo">
          {!alerts.length ? (
            <p className="text-sm text-ink-3">Chưa có cảnh báo.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft px-3 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <AlertBadge kind={a.kind} /> {alertText(a)}
                  </span>
                  <span className="text-[13px] text-ink-3">
                    {fmtVnShort(a.created_at, tz)}
                    {a.acknowledged_at ? ` · đã xử lý: ${a.note ?? ''}` : ' · chưa xử lý'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {manager && data && (
        <TaskFormModal
          open={planOpen}
          onClose={() => setPlanOpen(false)}
          owners={data.owners}
          types={data.types}
          onSaved={reload}
          initial={{ task_id: t.id, name: t.name, owner_id: t.owner_id, type_id: t.type_id ?? '', start_at: Date.parse(t.start_at), due_at: Date.parse(t.due_at), milestones: ms.map((m) => m.label), priority_note: t.priority_note ?? '' }}
        />
      )}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Huỷ task?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Không
            </Button>
            <Button variant="danger" busy={busy} disabled={!cancelReason.trim()} onClick={cancel}>
              Huỷ task
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-2">Dùng khi khách huỷ việc hoặc task bị tạo nhầm. Task huỷ không tính vào tỷ lệ trễ hạn. Muốn đổi deadline sau khi đã gửi check-in: huỷ rồi tạo task mới.</p>
        <Field label="Lý do (bắt buộc)">{(fid) => <Textarea id={fid} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />}</Field>
      </Modal>
      <Modal
        open={!!noteEdit}
        onClose={() => setNoteEdit(null)}
        title="Sửa tên và ưu tiên"
        footer={
          <Button busy={busy} disabled={!noteEdit?.name.trim()} onClick={saveNote}>
            Lưu
          </Button>
        }
      >
        {noteEdit && (
          <div className="flex flex-col gap-3">
            <Field label="Tên task">{(fid) => <Input id={fid} value={noteEdit.name} onChange={(e) => setNoteEdit({ ...noteEdit, name: e.target.value })} />}</Field>
            <Field label="Ưu tiên khi có rủi ro">{(fid) => <Textarea id={fid} value={noteEdit.note} onChange={(e) => setNoteEdit({ ...noteEdit, note: e.target.value })} />}</Field>
          </div>
        )}
      </Modal>
      <BlockerModal task={blocker} onClose={() => setBlocker(null)} onDone={reload} />
    </div>
  );
}
