import { useEffect, useMemo, useState } from 'react';
import { ALERT_LABEL, AlertKind, checkpointTimes, TASK_STATUS_LABEL, TaskStatus, validateTaskDraft } from '@/domain';
import { Badge, Banner, Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnLong, fmtVnShort, fromLocalInput, toLocalInput } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import type { CheckpointRow, MilestoneRow, Owner, TaskRow, TaskType } from './data';
import { typeMilestones } from './data';

export function TaskStatusBadge({ status, waiting }: { status: TaskStatus; waiting?: boolean }) {
  if (waiting && !['done', 'overdue', 'cancelled'].includes(status)) return <Badge tone="brand">CHỜ TRẢ LỜI</Badge>;
  const tone: Record<TaskStatus, 'neutral' | 'ok' | 'warn' | 'bad' | 'solidOk' | 'solidBad'> = {
    not_started: 'neutral',
    on_track: 'ok',
    at_risk: 'warn',
    blocked: 'bad',
    no_update: 'bad',
    done: 'solidOk',
    overdue: 'solidBad',
    cancelled: 'neutral',
  };
  return <Badge tone={tone[status]}>{TASK_STATUS_LABEL[status].toUpperCase()}</Badge>;
}

export function AlertBadge({ kind }: { kind: AlertKind }) {
  const tone = kind === 'at_risk' ? 'warn' : 'bad';
  return <Badge tone={tone}>{ALERT_LABEL[kind].toUpperCase()}</Badge>;
}

/** Four milestone pills: done (green), due by now but not done (amber), later (grey). */
export function MilestonePills({ milestones, checkpoints, now = Date.now() }: { milestones: MilestoneRow[]; checkpoints: CheckpointRow[]; now?: number }) {
  const planned = checkpoints.filter((c) => Date.parse(c.scheduled_at) <= now).length;
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4].map((i) => {
        const m = milestones.find((x) => x.idx === i);
        const done = !!m?.done_at;
        const due = !done && i <= planned;
        return (
          <div
            key={i}
            title={m?.label}
            className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-[11.5px] font-semibold leading-tight ${done ? 'bg-ok text-white' : due ? 'bg-warn-soft text-warn' : 'bg-canvas text-ink-3'}`}
          >
            {done ? '✓ ' : ''}
            {m?.label ?? `Mốc ${i}`}
          </div>
        );
      })}
    </div>
  );
}

export interface TaskFormValue {
  task_id?: string;
  name: string;
  owner_id: string;
  type_id: string;
  start_at: number | null;
  due_at: number | null;
  milestones: string[];
  priority_note: string;
}

export function emptyTask(now = Date.now()): TaskFormValue {
  const start = Math.ceil(now / 1_800_000) * 1_800_000;
  return { name: '', owner_id: '', type_id: '', start_at: start, due_at: null, milestones: ['', '', '', ''], priority_note: '' };
}

export function TaskFormModal({ open, onClose, initial, owners, types, onSaved }: { open: boolean; onClose: () => void; initial: TaskFormValue; owners: Owner[]; types: TaskType[]; onSaved: () => void }) {
  const { calendar, tz } = useSettings();
  const toast = useToast();
  const [v, setV] = useState<TaskFormValue>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(initial), [initial, open]);

  const errors = validateTaskDraft({ name: v.name, ownerId: v.owner_id || null, startAt: v.start_at, dueAt: v.due_at, milestones: v.milestones, now: Date.now() }, calendar);
  const preview = useMemo(() => {
    if (v.start_at === null || v.due_at === null) return null;
    try {
      return checkpointTimes(v.start_at, v.due_at, calendar);
    } catch {
      return null;
    }
  }, [v.start_at, v.due_at, calendar]);

  function pickType(id: string) {
    const t = types.find((x) => x.id === id);
    const untouched = v.milestones.every((m) => !m.trim()) || types.some((x) => typeMilestones(x).join('|') === v.milestones.join('|'));
    setV({ ...v, type_id: id, milestones: untouched && t ? typeMilestones(t) : v.milestones });
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        task_id: v.task_id,
        name: v.name,
        owner_id: v.owner_id,
        type_id: v.type_id || null,
        start_at: new Date(v.start_at as number).toISOString(),
        due_at: new Date(v.due_at as number).toISOString(),
        milestones: v.milestones,
        priority_note: v.priority_note,
      };
      await callApi(v.task_id ? 'task.update' : 'task.create', payload);
      toast(v.task_id ? 'Đã cập nhật kế hoạch task' : 'Đã tạo task và lên lịch 4 checkpoint');
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const owner = owners.find((o) => o.id === v.owner_id);
  return (
    <Modal
      open={open}
      wide
      onClose={onClose}
      title={v.task_id ? 'Sửa kế hoạch task' : 'Tạo task'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button busy={busy} disabled={errors.length > 0} onClick={save}>
            {v.task_id ? 'Lưu kế hoạch' : 'Tạo task'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tên task" className="md:col-span-2">{(id) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ví dụ: Banner chiến dịch 11.11 cho khách X" />}</Field>
        <Field label="Người phụ trách" hint={owner && !owner.telegram_linked ? 'Người này chưa liên kết Telegram: họ trả lời ở trang Check-in của tôi.' : undefined}>
          {(id) => (
            <Select id={id} value={v.owner_id} onChange={(e) => setV({ ...v, owner_id: e.target.value })}>
              <option value="">— Chọn —</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {(o.full_name || o.email) + (o.telegram_linked ? ' · Telegram' : ' · chỉ web')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Loại task" hint="Chọn loại để lấy 4 mốc chuẩn">
          {(id) => (
            <Select id={id} value={v.type_id} onChange={(e) => pickType(e.target.value)}>
              <option value="">— Không chọn —</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Bắt đầu" hint={v.start_at ? `Đang chọn: ${fmtVnLong(v.start_at, tz)}` : undefined}>
          {(id) => <Input id={id} type="datetime-local" value={toLocalInput(v.start_at, tz)} onChange={(e) => setV({ ...v, start_at: fromLocalInput(e.target.value, tz) })} />}
        </Field>
        <Field label="Deadline" hint={v.due_at ? `Đang chọn: ${fmtVnLong(v.due_at, tz)}` : undefined}>
          {(id) => <Input id={id} type="datetime-local" value={toLocalInput(v.due_at, tz)} onChange={(e) => setV({ ...v, due_at: fromLocalInput(e.target.value, tz) })} />}
        </Field>
        {v.milestones.map((m, i) => (
          <Field key={i} label={`Mốc ${i + 1} (${[25, 50, 75, 99][i]}% thời gian)`} hint={i === 0 ? 'Mỗi mốc phải kiểm chứng được: có sản phẩm hoặc bằng chứng cụ thể' : undefined}>
            {(id) => (
              <Input
                id={id}
                value={m}
                onChange={(e) => {
                  const ms = [...v.milestones];
                  ms[i] = e.target.value;
                  setV({ ...v, milestones: ms });
                }}
              />
            )}
          </Field>
        ))}
        <Field label="Ưu tiên khi có rủi ro (hiện trong cảnh báo)" className="md:col-span-2">
          {(id) => <Textarea id={id} value={v.priority_note} onChange={(e) => setV({ ...v, priority_note: e.target.value })} placeholder="Ví dụ: liên hệ KOC dự phòng ngay trong ngày" className="min-h-[64px]" />}
        </Field>
      </div>
      {preview && (
        <div className="mt-4 rounded-xl bg-canvas p-3">
          <div className="text-[13px] font-semibold text-ink-2">Bot sẽ hỏi tiến độ lúc (giờ làm việc):</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {preview.map((t, i) => (
              <Badge key={i} tone="brand">
                {[25, 50, 75, 99][i]}% · {fmtVnShort(t.getTime(), tz)}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {errors.length > 0 && (v.name || v.owner_id || v.due_at) && (
        <Banner tone="warn" className="mt-3">
          {errors.join(' ')}
        </Banner>
      )}
    </Modal>
  );
}

export function BlockerModal({ task, onClose, onDone }: { task: TaskRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(''), [task]);
  async function send() {
    if (!task) return;
    setBusy(true);
    try {
      await callApi('checkin.blocker', { task_id: task.id, reason });
      toast('Đã báo E-commerce Executive ngay');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={!!task}
      onClose={onClose}
      title={`Báo bị chặn · ${task?.name ?? ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={send}>
            Báo ngay
          </Button>
        </>
      }
    >
      <Field label="Vì sao bị chặn? (bắt buộc)" hint="Ví dụ: khách chưa gửi ảnh sản phẩm, chưa có quyền vào CMS">
        {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}
