import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BUSY_OPEN, daysBetween, Health, HEALTH_LABEL, LOAD_LABEL, LoadState, loadState, shiftKey } from '@/domain';
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
const HEALTH_RANK_UI: Health[] = ['red', 'amber', 'blue', 'green'];

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
            <span>Thanh màu: task đang làm theo sức khoẻ, từ {BUSY_OPEN} task là kín việc. Rê chuột hoặc bấm vào màu, vào ô ngày để xem task.</span>
            <span>Hàng hạn chót: mỗi task nằm đúng một ô, cộng lại bằng số trên thanh.</span>
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
  const scale = Math.max(BUSY_OPEN, p.open.length);
  const room = BUSY_OPEN - p.open.length;
  const later = p.open.filter((t) => t.due_date > days[days.length - 1]);
  const attention = [...p.overdue, ...p.blocked.filter((t) => !p.overdue.includes(t))].slice(0, 3);
  const next = p.open.find((t) => t.due_date >= today);
  const segs = (['red', 'amber', 'blue', 'green'] as Health[]).map((h) => [h, p.open.filter((t) => t.health === h)] as const).filter(([, ts]) => ts.length);
  const pop = usePeek();
  return (
    <li ref={pop.ref} className={cx('flex flex-col gap-3 rounded-xl border border-l-4 border-line bg-white p-4 shadow-sheet', st.edge)}>
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

      {/* load: open tasks split by health, against the "kín việc" threshold */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
          <span className="font-medium text-ink-2">
            <b className="text-[18px] text-ink">{p.open.length}</b> task đang làm
          </span>
          <span className={cx(room <= 0 && p.open.length ? 'font-medium text-warn' : 'text-ink-3')}>
            {!p.open.length ? 'Có thể giao việc' : room > 0 ? `Nhận thêm được ${room} task` : room === 0 ? `Đã chạm ngưỡng ${BUSY_OPEN} task` : `Vượt ngưỡng ${BUSY_OPEN} task (+${-room})`}
          </span>
        </div>
        <div className="relative flex h-3 gap-px rounded-full bg-ink/[0.06]">
          {segs.map(([h, ts], i) => (
            <Peek
              key={h}
              id={`bar:${h}`}
              pop={pop}
              wrap="h-full"
              style={{ width: `${(ts.length / scale) * 100}%` }}
              className={cx('h-full', BAR[h], i === 0 && 'rounded-l-full', i === segs.length - 1 && p.open.length >= scale && 'rounded-r-full', pop.active === `bar:${h}` ? 'ring-2 ring-ink ring-offset-1' : 'hover:brightness-110')}
              title={`${ts.length} task ${lower(HEALTH_LABEL[h])}`}
              tasks={ts}
              today={today}
              onOpen={onOpen}
              align={i === segs.length - 1 && segs.length > 1 ? 'right' : 'left'}
            />
          ))}
          {p.open.length > BUSY_OPEN && <span aria-hidden className="pointer-events-none absolute -inset-y-0.5 w-0.5 bg-ink" style={{ left: `${(BUSY_OPEN / scale) * 100}%` }} />}
        </div>
        {segs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-1 gap-y-0.5 text-[12.5px] text-ink-2">
            {segs.map(([h, ts]) => (
              <Peek key={h} id={`leg:${h}`} pop={pop} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-canvas" title={`${ts.length} task ${lower(HEALTH_LABEL[h])}`} tasks={ts} today={today} onOpen={onOpen}>
                <span aria-hidden className={cx('h-2 w-2 rounded-full', BAR[h])} />
                <b className="font-semibold text-ink">{ts.length}</b> {lower(HEALTH_LABEL[h])}
              </Peek>
            ))}
          </div>
        )}
      </div>

      {/* due dates: every open task sits in exactly one cell, so the row adds up to the bar */}
      {p.open.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="font-medium text-ink-2">Hạn chót của {p.open.length} task</span>
            {next && <span className="text-ink-3">Gần nhất: {dueText(next.due_date, today)}</span>}
          </div>
          <div className="flex gap-1.5" aria-label="Số task theo hạn chót">
            <DueCell id="due:over" pop={pop} onOpen={onOpen} todayKey={today} label="Quá hạn" tasks={p.overdue} tone="bad" />
            <div className="grid flex-[7] grid-cols-7 gap-1">
              {days.map((d, i) => {
                const weekend = [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
                return <DueCell key={d} id={`due:${d}`} pop={pop} onOpen={onOpen} todayKey={today} align={i >= 4 ? 'right' : 'left'} label={i === 0 ? 'Nay' : WD[new Date(`${d}T00:00:00Z`).getUTCDay()]} sub={d.slice(8, 10) + '/' + d.slice(5, 7)} tasks={p.open.filter((t) => t.due_date === d)} today={i === 0} weekend={weekend} />;
              })}
            </div>
            <DueCell id="due:later" pop={pop} onOpen={onOpen} todayKey={today} align="right" label="Sau đó" tasks={later} />
          </div>
        </div>
      )}

      {/* counters, only when non-zero (quá hạn already shows in the due row) */}
      {(p.blocked.length > 0 || p.changes > 0 || p.review > 0) && (
        <div className="flex flex-wrap gap-1.5">
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

/** One slot of the due-date row: how many tasks fall due there, one dot per task in its health colour. Hover or click lists them. */
function DueCell({ id, pop, onOpen, todayKey, align, label, sub, tasks, tone, today, weekend }: { id: string; pop: PeekState; onOpen: (t: Task) => void; todayKey: string; align?: 'left' | 'right'; label: string; sub?: string; tasks: Task[]; tone?: 'bad'; today?: boolean; weekend?: boolean }) {
  const n = tasks.length;
  const hot = tone === 'bad' && n > 0;
  const body = (
    <>
      <div className={cx('truncate text-[11px] leading-tight', hot ? 'font-semibold text-bad' : today ? 'font-semibold text-brand' : 'text-ink-3')}>{label}</div>
      {sub && <div className="text-[10.5px] leading-tight text-ink-3">{sub}</div>}
      <div className={cx('mt-0.5 text-[15px] font-semibold leading-tight', hot ? 'text-bad' : n ? 'text-ink' : 'text-ink-3/50')}>{n || '–'}</div>
      <div className="mt-0.5 flex h-1.5 items-center justify-center gap-0.5" aria-hidden>
        {[...tasks].sort((a, b) => HEALTH_RANK_UI.indexOf(a.health) - HEALTH_RANK_UI.indexOf(b.health)).slice(0, 4).map((t) => (
          <span key={t.id} className={cx('h-1.5 w-1.5 rounded-full', BAR[t.health] ?? 'bg-ink-3')} />
        ))}
      </div>
    </>
  );
  const base = cx(
    'flex w-full min-w-0 flex-col items-center rounded-md px-0.5 py-1 text-center',
    hot ? 'bg-bad-soft' : n ? 'bg-brand-soft' : weekend ? 'bg-canvas' : 'bg-white ring-1 ring-inset ring-line-soft',
  );
  if (!n) return <div className={cx(base, 'flex-1')} title={`${label}${sub ? ` ${sub}` : ''}: không có task`}>{body}</div>;
  return (
    <Peek id={id} pop={pop} wrap="flex-1 min-w-0" className={cx(base, pop.active === id ? 'ring-2 ring-inset ring-ink' : 'hover:ring-1 hover:ring-inset hover:ring-ink-3')} title={`${label}${sub ? ` ${sub}` : ''}`} tasks={tasks} today={todayKey} onOpen={onOpen} align={align}>
      {body}
    </Peek>
  );
}

/** Which peek is open on a card: hover shows it, click pins it until a click outside or Esc. */
interface PeekState {
  ref: React.RefObject<HTMLLIElement>;
  active: string | null;
  hover: (id: string | null) => void;
  toggle: (id: string) => void;
}
function usePeek(): PeekState {
  const ref = useRef<HTMLLIElement>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    if (!pinned) return;
    const out = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setPinned(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(null);
    document.addEventListener('mousedown', out);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', out);
      document.removeEventListener('keydown', esc);
    };
  }, [pinned]);
  return { ref, active: hovered ?? pinned, hover: setHovered, toggle: (id) => setPinned((cur) => (cur === id ? null : id)) };
}

/** A trigger (bar segment, legend item, due cell) with a small list of its tasks underneath. */
function Peek({ id, pop, tasks, today, onOpen, title, className, style, wrap, align = 'left', children }: { id: string; pop: PeekState; tasks: Task[]; today: string; onOpen: (t: Task) => void; title: string; className?: string; style?: React.CSSProperties; wrap?: string; align?: 'left' | 'right'; children?: ReactNode }) {
  const open = pop.active === id;
  return (
    <div className={cx('relative', wrap)} style={style} onMouseEnter={() => pop.hover(id)} onMouseLeave={() => pop.hover(null)}>
      <button type="button" aria-expanded={open} aria-label={`${title}: xem task`} onClick={() => pop.toggle(id)} className={cx('block', className)} style={style ? { width: '100%' } : undefined}>
        {children}
      </button>
      {open && (
        <div className={cx('absolute top-full z-20 w-80 pt-1.5', align === 'right' ? 'right-0' : 'left-0')}>
          <div className="rounded-lg border border-line bg-white p-1.5 shadow-lg">
            <div className="px-1.5 pb-1 pt-0.5 text-[12px] font-semibold text-ink-3">{title}</div>
            <ul className="flex max-h-64 flex-col overflow-auto">
              {tasks.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpen(t)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-canvas">
                    <HealthDot health={t.health} reason={t.reason} />
                    <span className="font-mono text-[12px] text-brand">{t.code}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{t.name}</span>
                    <span className={cx('shrink-0 text-[12px]', t.due_date < today ? 'font-medium text-bad' : 'text-ink-3')}>{dueText(t.due_date, today)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts.length > 1 ? parts[parts.length - 2][0] : '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function dueText(due: string, today: string): string {
  const n = daysBetween(today, due);
  return n < 0 ? `quá ${-n} ngày` : n === 0 ? 'hôm nay' : n === 1 ? 'ngày mai' : `còn ${n} ngày`;
}
