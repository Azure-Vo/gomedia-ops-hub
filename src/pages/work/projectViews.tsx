import { ReactNode, useState } from 'react';
import { daysBetween, fmtDueDate, HEALTH_LABEL, localDateKey, MEMBER_STATUS_LABEL, Health } from '@/domain';
import { Badge, Button, cx, Field, Icon, IconName, Select } from '@/components/ui';
import { isMine, MemberRow, PersonRow, Task } from './data';
import { StageBadge } from './parts';

// ------------------------------------------------------------------------------- shared marks --------

const RAIL: Record<Health, string> = { red: 'bg-bad', amber: 'bg-[#D08A1A]', green: 'bg-ok', blue: 'bg-brand', done: 'bg-line-control/50', cancelled: 'bg-line' };

export function initialsOf(name: string): string {
  const parts = name.replace(/@.*/, '').trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
}

export function Avatar({ name, size = 28, tone = 'neutral' }: { name: string; size?: number; tone?: 'neutral' | 'brand' | 'bad' }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className={cx('grid shrink-0 place-items-center rounded-full font-semibold', tone === 'brand' ? 'bg-brand-soft text-brand' : tone === 'bad' ? 'bg-bad-soft text-bad' : 'bg-line-soft text-ink')}
    >
      {initialsOf(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------------- task list --------

type Filter = 'all' | 'attention' | 'doing' | 'review' | 'done';
const FILTERS: { k: Filter; label: string; test: (t: Task) => boolean }[] = [
  { k: 'all', label: 'Tất cả', test: () => true },
  { k: 'attention', label: 'Cần chú ý', test: (t) => (t.state === 'doing' || t.state === 'changes') && (t.health === 'red' || t.health === 'amber') },
  { k: 'doing', label: 'Đang làm', test: (t) => t.state === 'doing' || t.state === 'changes' },
  { k: 'review', label: 'Chờ duyệt', test: (t) => t.state === 'review' },
  { k: 'done', label: 'Hoàn thành', test: (t) => t.state === 'done' },
];

/** Tasks of one project as a sheet: filter chips, a colour rail for health, assignee, deadline and stage. */
export function ProjectTaskList({ tasks, today, onOpen, actions, empty, showAssignee = true }: { tasks: Task[]; today: string; onOpen: (t: Task) => void; actions?: ReactNode; empty?: ReactNode; showAssignee?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const live = tasks.filter((t) => t.state !== 'cancelled');
  const shown = live.filter(FILTERS.find((f) => f.k === filter)!.test);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Lọc task" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = live.filter(f.test).length;
            if (f.k !== 'all' && !n) return null;
            const on = filter === f.k;
            return (
              <button
                key={f.k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setFilter(f.k)}
                className={cx('inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-medium transition-colors', on ? 'border-ink bg-ink text-white' : 'border-line-edge bg-paper text-ink-2 hover:border-line-control')}
              >
                {f.k === 'attention' && <span className={cx('h-2 w-2 rounded-full', on ? 'bg-white' : 'bg-bad')} />}
                {f.label}
                <span className={cx('tabular-nums', on ? 'text-white/70' : 'text-ink-3')}>{n}</span>
              </button>
            );
          })}
        </div>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      {!live.length ? (
        empty
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div className={cx('hidden gap-4 border-b border-line px-5 py-2.5 text-[12.5px] font-semibold text-ink-3 md:grid', showAssignee ? 'grid-cols-[minmax(0,1fr)_200px_170px_110px_16px]' : 'grid-cols-[minmax(0,1fr)_170px_110px_16px]')}>
            <span>Task</span>
            {showAssignee && <span>Người thực hiện</span>}
            <span>Deadline</span>
            <span>Trạng thái</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {shown.map((t) => (
              <TaskRowItem key={t.id} t={t} today={today} onOpen={onOpen} showAssignee={showAssignee} />
            ))}
            {!shown.length && <li className="px-5 py-6 text-center text-[14px] text-ink-3">Không có task trong mục này.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function TaskRowItem({ t, today, onOpen, showAssignee }: { t: Task; today: string; onOpen: (t: Task) => void; showAssignee: boolean }) {
  const open = t.state === 'doing' || t.state === 'changes';
  const left = daysBetween(today, t.due_date);
  const done = t.state === 'done';
  const warn = t.health === 'red' || t.health === 'amber';
  return (
    <li className="relative">
      <span aria-hidden className={cx('absolute inset-y-0 left-0 w-[3px]', RAIL[t.health])} />
      <button
        type="button"
        onClick={() => onOpen(t)}
        title={`${HEALTH_LABEL[t.health]}${t.reason ? `: ${t.reason}` : ''}`}
        className={cx('group grid w-full items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-left transition-colors hover:bg-canvas/60', showAssignee ? 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_200px_170px_110px_16px]' : 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_170px_110px_16px]')}
      >
        <span className="col-span-2 min-w-0 md:col-span-1">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-[12.5px] text-brand">{t.code}</span>
            <span className={cx('truncate text-[15px] font-medium group-hover:text-brand', done ? 'text-ink-3' : 'text-ink')}>{t.name}</span>
          </span>
          {open && warn && (
            <span className={cx('mt-1 flex items-start gap-1.5 text-[13px]', t.health === 'red' ? 'text-bad' : 'text-warn')}>
              <Icon name={t.progress === 'blocked' ? 'ban' : t.noUpdate ? 'ask' : 'alert'} size={14} className="mt-[2px] shrink-0" />
              <span className="min-w-0">{t.reason}</span>
            </span>
          )}
        </span>
        {showAssignee && (
          <span className="flex min-w-0 items-center gap-2 text-[13.5px] text-ink-2">
            {t.assignee_name ? (
              <>
                <Avatar name={t.assignee_name} size={26} />
                <span className="truncate">{t.assignee_name}</span>
              </>
            ) : (
              <span className="text-ink-3">Chưa giao</span>
            )}
          </span>
        )}
        <span className="flex flex-col text-[13.5px] tabular-nums">
          <span className={done ? 'text-ink-3' : 'text-ink'}>{fmtDueDate(t.due_date)}</span>
          {open && <span className={cx('text-[12.5px]', left < 0 ? 'font-semibold text-bad' : left <= 1 ? 'text-warn' : 'text-ink-3')}>{left < 0 ? `Quá ${-left} ngày` : left === 0 ? 'Hạn hôm nay' : `Còn ${left} ngày`}</span>}
        </span>
        <span>
          <StageBadge state={t.state} />
        </span>
        <Icon name="chevronRight" size={16} className="hidden text-ink-3 group-hover:text-brand md:block" />
      </button>
    </li>
  );
}

// ------------------------------------------------------------------------------------ members --------

const SOURCE: Record<MemberRow['source'], string> = { group: 'Từ group Lark', task: 'Được giao task', manual: 'PM mời' };
const STATUS_TONE = { accepted: 'ok', invited: 'brand', declined: 'bad' } as const;
const fmtDay = (s: string | null) => (s ? fmtDueDate(localDateKey(Date.parse(s), 'Asia/Ho_Chi_Minh')).slice(0, 5) : '');

/** Project members as cards grouped by answer, each with the person's load in this project. */
export function MemberBoard({
  members,
  people,
  tasks,
  today,
  canEdit,
  live,
  onInvite,
  onRemove,
  onReinvite,
}: {
  members: MemberRow[];
  people: PersonRow[];
  tasks: Task[];
  today: string;
  canEdit: boolean;
  live: boolean;
  onInvite: (profileId: string) => Promise<unknown>;
  onRemove: (m: MemberRow) => void;
  onReinvite: (m: MemberRow) => void;
}) {
  const [add, setAdd] = useState('');
  const [busy, setBusy] = useState(false);
  const has = new Set(members.filter((m) => m.status !== 'declined').map((m) => m.profile_id));
  const candidates = people.filter((p) => p.active && !has.has(p.id) && !['admin', 'ceo', 'pm'].includes(p.role));
  const groups: { status: MemberRow['status']; title: string; icon: IconName }[] = [
    { status: 'invited', title: 'Đang chờ trả lời', icon: 'send' },
    { status: 'accepted', title: 'Đã tham gia', icon: 'users' },
    { status: 'declined', title: 'Đã từ chối', icon: 'userX' },
  ];
  const load = (m: MemberRow) => {
    const mine = tasks.filter((t) => m.profile_id && isMine(t, m.profile_id) && t.state !== 'cancelled');
    const openT = mine.filter((t) => t.state === 'doing' || t.state === 'changes');
    return {
      open: openT.length,
      late: openT.filter((t) => daysBetween(today, t.due_date) < 0).length,
      review: mine.filter((t) => t.state === 'review').length,
      done: mine.filter((t) => t.state === 'done').length,
    };
  };
  return (
    <div className="flex flex-col gap-6">
      {canEdit && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-paper p-5">
          <div className="flex min-w-0 flex-1 basis-72 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
              <Icon name="userPlus" size={19} />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-ink">Mời thành viên</div>
              <div className="text-[13px] text-ink-3">Chỉ giao task cho người đã Tham gia.{live ? ' Người trong group Lark của dự án tự là thành viên.' : ''}</div>
            </div>
          </div>
          <Field label="Người được mời" className="w-full sm:w-72">
            {(id) => (
              <Select id={id} value={add} onChange={(e) => setAdd(e.target.value)}>
                <option value="">Chọn người…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button icon="send" busy={busy} disabled={!add} onClick={() => (setBusy(true), onInvite(add).then(() => setAdd('')).finally(() => setBusy(false)))}>
            Gửi lời mời
          </Button>
        </div>
      )}
      {!canEdit && <p className="text-[14px] text-ink-3">Chỉ giao task cho người đã Tham gia.{live ? ' Người trong group Lark của dự án tự là thành viên.' : ''}</p>}
      {groups.map((g) => {
        const rows = members.filter((m) => m.status === g.status).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        if (!rows.length) return null;
        return (
          <section key={g.status} aria-label={g.title}>
            <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
              <Icon name={g.icon} size={16} className="text-ink-3" />
              {g.title}
              <span className="font-medium text-ink-3">{rows.length}</span>
            </h3>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((m) => {
                const l = load(m);
                const editable = canEdit && m.profile_id && m.source !== 'group';
                return (
                  <li key={m.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-paper p-4">
                    <div className="flex items-start gap-3">
                      <Avatar name={m.name || '?'} size={40} tone={m.status === 'invited' ? 'brand' : m.status === 'declined' ? 'bad' : 'neutral'} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-ink">{m.name || '—'}</div>
                        <div className="mt-0.5 text-[12.5px] text-ink-3">
                          {SOURCE[m.source]}
                          {m.status === 'invited' && m.invited_at && `, mời ngày ${fmtDay(m.invited_at)}`}
                          {m.status !== 'invited' && m.responded_at && m.source === 'manual' && `, trả lời ngày ${fmtDay(m.responded_at)}`}
                        </div>
                      </div>
                      <Badge tone={STATUS_TONE[m.status]}>{MEMBER_STATUS_LABEL[m.status]}</Badge>
                    </div>
                    {!m.profile_id && <Badge tone="warn" className="w-fit">Chưa có tài khoản Ops Hub</Badge>}
                    {m.status === 'declined' && <p className="rounded-xl bg-bad-soft px-3 py-2 text-[13.5px] text-bad">Lý do: {m.decline_reason || 'không ghi'}</p>}
                    {m.status === 'accepted' && (
                      <dl className="grid grid-cols-3 gap-2 rounded-xl bg-canvas/70 px-3 py-2.5 text-center">
                        <div>
                          <dt className="text-[11.5px] text-ink-3">Đang làm</dt>
                          <dd className={cx('text-[17px] font-semibold tabular-nums', l.late ? 'text-bad' : 'text-ink')}>
                            {l.open}
                            {l.late > 0 && <span className="ml-1 text-[11.5px] font-medium">({l.late} trễ)</span>}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11.5px] text-ink-3">Chờ duyệt</dt>
                          <dd className="text-[17px] font-semibold tabular-nums text-ink">{l.review}</dd>
                        </div>
                        <div>
                          <dt className="text-[11.5px] text-ink-3">Xong</dt>
                          <dd className="text-[17px] font-semibold tabular-nums text-ink">{l.done}</dd>
                        </div>
                      </dl>
                    )}
                    {editable && (
                      <div className="mt-auto flex justify-end gap-2 border-t border-line pt-3">
                        {m.status === 'declined' && (
                          <Button size="sm" variant="secondary" icon="send" onClick={() => onReinvite(m)}>
                            Mời lại
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" icon={m.status === 'accepted' ? 'userX' : 'x'} onClick={() => onRemove(m)}>
                          {m.status === 'accepted' ? 'Bỏ khỏi dự án' : m.status === 'invited' ? 'Huỷ lời mời' : 'Xoá'}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!members.length && <p className="text-[14px] text-ink-3">Chưa có thành viên.</p>}
    </div>
  );
}
