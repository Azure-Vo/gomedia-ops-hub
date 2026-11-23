import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BUSY_OPEN, daysBetween, fmtDueDate, Health, LOAD_LABEL, LoadState, loadState, shiftKey } from '@/domain';
import { Badge, cx, EmptyState, ErrorBox, Icon, PageHeader, PageSkeleton } from '@/components/ui';
import { useProfile } from '@/lib/session';
import { isProjectPm, Project, Task } from './data';
import { TaskHost, useOpenTask, useWork } from './hooks';
import { HealthDot, ProjectSwatch } from './parts';

const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const STATE_STYLE: Record<LoadState, { chip: string; edge: string }> = {
  help: { chip: 'bg-bad-soft text-bad', edge: 'border-l-bad' },
  busy: { chip: 'bg-warn-soft text-warn', edge: 'border-l-[#D08A1A]' },
  ok: { chip: 'bg-ok-soft text-ok-ink', edge: 'border-l-ok' },
  free: { chip: 'bg-brand-soft text-brand', edge: 'border-l-brand' },
};
const BAR: Partial<Record<Health, string>> = { red: 'bg-bad', amber: 'bg-[#D08A1A]', green: 'bg-ok', blue: 'bg-brand' };
const ORDER: LoadState[] = ['help', 'busy', 'ok', 'free'];

interface PersonCard {
  key: string;
  name: string;
  open: Task[];
  overdue: Task[];
  blocked: Task[];
  review: number;
  changes: number;
  next7: number;
  byDay: number[];
  projects: Project[];
  state: LoadState;
}

/** PRD 4.2 · Nhân sự: ai đang cần hỗ trợ, ai kín việc, ai còn rảnh, trước khi giao thêm việc. */
export function PeoplePage() {
  const me = useProfile();
  const { data, loading, error, reload } = useWork();
  const { open: openTask } = useOpenTask(data);
  const [only, setOnly] = useState<LoadState | ''>('');
  if (loading && !data) return <PageSkeleton kind="cards" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const today = data.today;
  const days = Array.from({ length: 7 }, (_, i) => shiftKey(today, i));
  const mineProjects = data.projects.filter((p) => p.state === 'active' && (me.role !== 'pm' || isProjectPm(p, me)));
  const projectIds = new Set(mineProjects.map((p) => p.id));
  const scope = data.tasks.filter((t) => projectIds.has(t.parent_id));

  // Everyone who works in these projects, plus active staff with nothing yet (they are the free hands).
  const cards = new Map<string, { name: string; tasks: Task[]; projects: Set<string> }>();
  const add = (key: string, name: string) => cards.get(key) ?? (cards.set(key, { name, tasks: [], projects: new Set() }), cards.get(key)!);
  for (const p of data.people) if (p.active && !['admin', 'ceo', 'pm'].includes(p.role)) add(p.id, p.full_name || p.email);
  for (const p of mineProjects) for (const m of p.members) if (m.status === 'accepted' && m.profile_id) add(m.profile_id, data.people.find((x) => x.id === m.profile_id)?.full_name ?? m.name).projects.add(p.id);
  for (const t of scope) {
    const c = add(t.assignee_id ?? t.assignee_open_id ?? '—', t.assignee_name ?? '—');
    c.tasks.push(t);
    c.projects.add(t.parent_id);
  }

  const people: PersonCard[] = [...cards.entries()].map(([key, c]) => {
    const open = c.tasks.filter((t) => t.state === 'doing' || t.state === 'changes').sort((a, b) => a.due_date.localeCompare(b.due_date));
    const overdue = open.filter((t) => t.due_date < today);
    const blocked = open.filter((t) => t.progress === 'blocked');
    const byDay = days.map((d) => open.filter((t) => t.due_date === d).length);
    const next7 = byDay.reduce((a, b) => a + b, 0);
    return {
      key,
      name: c.name,
      open,
      overdue,
      blocked,
      review: c.tasks.filter((t) => t.state === 'review').length,
      changes: c.tasks.filter((t) => t.state === 'changes').length,
      next7,
      byDay,
      projects: mineProjects.filter((p) => c.projects.has(p.id)),
      state: loadState({ open: open.length, overdue: overdue.length, blocked: blocked.length, next7 }),
    };
  });
  people.sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || b.overdue.length - a.overdue.length || b.open.length - a.open.length || a.name.localeCompare(b.name, 'vi'));
  const count = (s: LoadState) => people.filter((p) => p.state === s).length;
  const shown = only ? people.filter((p) => p.state === only) : people;

  return (
    <div>
      <PageHeader title="Nhân sự" subtitle="Ai cần hỗ trợ, ai còn rảnh. Xem trước khi giao việc." />

      {!people.length ? (
        <EmptyState title="Chưa có nhân sự nào" />
      ) : (
        <>
          <div role="tablist" aria-label="Lọc theo mức bận" className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORDER.map((s) => {
              const on = only === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setOnly(on ? '' : s)}
                  className={cx('flex items-center justify-between rounded-xl border bg-white px-4 py-3 text-left transition-colors', on ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-ink-3')}
                >
                  <span className={cx('rounded-full px-2 py-0.5 text-[13px] font-semibold', STATE_STYLE[s].chip)}>{LOAD_LABEL[s]}</span>
                  <span className="text-[26px] font-semibold leading-none text-ink">{count(s)}</span>
                </button>
              );
            })}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
            <span>Thanh = task đang làm, màu theo sức khoẻ; mốc dọc = {BUSY_OPEN} task</span>
            <span>Ô ngày = số task đến hạn</span>
            {only && (
              <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setOnly('')}>
                Bỏ lọc
              </button>
            )}
          </div>

          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((p) => (
              <PersonItem key={p.key} p={p} days={days} today={today} onOpen={openTask} />
            ))}
          </ul>
        </>
      )}
      <TaskHost data={data} reload={reload} />
    </div>
  );
}

function PersonItem({ p, days, today, onOpen }: { p: PersonCard; days: string[]; today: string; onOpen: (t: Task) => void }) {
  const st = STATE_STYLE[p.state];
  const scale = Math.max(BUSY_OPEN + 1, p.open.length);
  const attention = [...p.overdue, ...p.blocked.filter((t) => !p.overdue.includes(t))].slice(0, 3);
  const next = p.open.find((t) => t.due_date >= today);
  const segs = (['red', 'amber', 'green', 'blue'] as Health[]).map((h) => [h, p.open.filter((t) => t.health === h).length] as const).filter(([, n]) => n);
  return (
    <li className={cx('flex flex-col gap-3 rounded-xl border border-l-4 border-line bg-white p-4 shadow-sheet', st.edge)}>
      {/* who + state */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-[14px] font-semibold text-ink-2" aria-hidden>
          {initials(p.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold text-ink">{p.name}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
            {p.projects.length ? (
              p.projects.map((pr) => (
                <Link key={pr.id} to={`/du-an/${encodeURIComponent(pr.code)}`} className="inline-flex items-center gap-1 hover:text-ink hover:underline">
                  <ProjectSwatch color={pr.color} className="h-2 w-2" />
                  {pr.code}
                </Link>
              ))
            ) : (
              <span>Chưa trong dự án nào của bạn</span>
            )}
          </div>
        </div>
        <span className={cx('rounded-full px-2.5 py-0.5 text-[13px] font-semibold', st.chip)}>{LOAD_LABEL[p.state]}</span>
      </div>

      {/* load bar */}
      <div>
        <div className="mb-1 flex items-baseline justify-between text-[13px]">
          <span className="font-medium text-ink-2">
            <b className="text-[18px] text-ink">{p.open.length}</b> task đang làm
          </span>
          <span className="text-ink-3">{next ? `Gần nhất: ${dueText(next.due_date, today)}` : p.open.length ? '' : 'Có thể giao việc'}</span>
        </div>
        <div className="relative flex h-2.5 overflow-hidden rounded-full bg-ink/[0.06]" role="img" aria-label={`${p.open.length} task đang làm trên mốc ${BUSY_OPEN}`}>
          {segs.map(([h, n]) => (
            <span key={h} className={BAR[h]} style={{ width: `${(n / scale) * 100}%` }} />
          ))}
          <span aria-hidden className="absolute inset-y-0 w-px bg-ink/40" style={{ left: `${(BUSY_OPEN / scale) * 100}%` }} />
        </div>
      </div>

      {/* next 7 days */}
      <div className="grid grid-cols-7 gap-1" aria-label="Task đến hạn 7 ngày tới">
        {days.map((d, i) => {
          const n = p.byDay[i];
          const weekend = [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
          return (
            <div key={d} className={cx('rounded-md px-1 py-1 text-center', n >= 3 ? 'bg-[#D3DCF3]' : n === 2 ? 'bg-brand-soft' : n === 1 ? 'bg-brand-soft/50' : weekend ? 'bg-canvas' : 'bg-white ring-1 ring-inset ring-line-soft')} title={`${fmtDueDate(d)}: ${n} task đến hạn`}>
              <div className={cx('text-[11px]', i === 0 ? 'font-semibold text-brand' : 'text-ink-3')}>{i === 0 ? 'Nay' : WD[new Date(`${d}T00:00:00Z`).getUTCDay()]}</div>
              <div className={cx('text-[14px] font-semibold leading-tight', n ? 'text-ink' : 'text-ink-3/50')}>{n || '–'}</div>
            </div>
          );
        })}
      </div>

      {/* counters, only when non-zero */}
      {(p.overdue.length > 0 || p.blocked.length > 0 || p.changes > 0 || p.review > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {p.overdue.length > 0 && <Badge tone="bad">{p.overdue.length} quá hạn</Badge>}
          {p.blocked.length > 0 && <Badge tone="bad">{p.blocked.length} bị chặn</Badge>}
          {p.changes > 0 && <Badge tone="warn">{p.changes} cần sửa</Badge>}
          {p.review > 0 && <Badge tone="brand">{p.review} chờ bạn duyệt</Badge>}
        </div>
      )}

      {/* what to look at first */}
      {attention.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line-soft pt-2">
          {attention.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpen(t)} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[13.5px] hover:bg-canvas">
                <HealthDot health={t.health} reason={t.reason} />
                <span className="font-mono text-[12.5px] text-brand">{t.code}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{t.name}</span>
                <span className="shrink-0 text-[12.5px] font-medium text-bad">{t.progress === 'blocked' && t.due_date >= today ? 'bị chặn' : dueText(t.due_date, today)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex justify-end">
        <Link to={`/lich?view=people&nguoi=${encodeURIComponent(p.key)}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline">
          <Icon name="calendar" size={14} /> Xem lịch
        </Link>
      </div>
    </li>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts.length > 1 ? parts[parts.length - 2][0] : '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function dueText(due: string, today: string): string {
  const n = daysBetween(today, due);
  return n < 0 ? `quá ${-n} ngày` : n === 0 ? 'hôm nay' : n === 1 ? 'ngày mai' : `còn ${n} ngày`;
}
