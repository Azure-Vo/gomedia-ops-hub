// PRD 8 · Calendar. Layout taken from the Agendal prototype (Figma "07 Prototype", Web · 05 Calendar):
// ‹ period title ›, then Hôm nay beside a segmented view switch, a month grid with filled chips for milestones and
// outlined chips for tasks, a right-hand panel, and drag-to-another-day. No hour grid: Go Media tasks only
// have a deadline date. Staff see their own tasks (no drag); the PM sees the projects they run and can
// drag a task to another day, which opens the extension dialog (a reason is required).
import { DragEvent, ReactNode, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  checkinDates,
  daysBetween,
  ExtendReason,
  extensionErrors,
  fmtDueDate,
  Health,
  HEALTH_LABEL,
  loadLevel,
  monthGrid,
  shiftKey,
  shiftMonth,
  tierOf,
  weekOf,
} from '@/domain';
import { Banner, Button, cx, ErrorBox, Field, Icon, IconButton, Input, Modal, Select, useToast, PageSkeleton } from '@/components/ui';
import { callApi } from '@/lib/api';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { isMine, isProjectPm, Project, Task } from './data';
import { TaskHost, useOpenTask, useWork } from './hooks';
import { ExtendReasonPicker, HealthDot, ProjectSwatch } from './parts';

type View = 'week' | 'month' | 'people';
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
const HEALTH_EDGE: Record<Health, string> = { red: 'border-l-bad', amber: 'border-l-[#D08A1A]', green: 'border-l-ok', blue: 'border-l-brand', done: 'border-l-ok-line', cancelled: 'border-l-line' };
const LOAD_BG = ['bg-white', 'bg-brand-soft/50', 'bg-brand-soft', 'bg-[#D3DCF3]'];

interface Drag {
  kind: 'task' | 'project';
  id: string;
}

export function CalendarPage() {
  const me = useProfile();
  const toast = useToast();
  const { calendar } = useSettings();
  const { data, loading, error, reload } = useWork();
  const { open } = useOpenTask(data);
  const [params, setParams] = useSearchParams();
  const manager = me.role === 'pm' || me.role === 'ceo';
  const canDrag = me.role === 'pm';
  const view: View = (params.get('view') as View) || (manager ? 'month' : 'week');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [personFilter, setPersonFilter] = useState(params.get('nguoi') ?? '');
  const [healthFilter, setHealthFilter] = useState<'' | 'red' | 'amber'>('');
  const [hideDone, setHideDone] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dropTask, setDropTask] = useState<{ task: Task; to: string } | null>(null);
  const [dropProject, setDropProject] = useState<{ project: Project; to: string } | null>(null);

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const day = anchor ?? today;
  const setView = (v: View) => {
    const n = new URLSearchParams(params);
    n.set('view', v);
    setParams(n, { replace: true });
  };

  const scope = useMemo(() => {
    if (!data) return { tasks: [] as Task[], projects: [] as Project[] };
    const projects = data.projects.filter((p) => p.state !== 'cancelled' && (manager ? me.role === 'ceo' || isProjectPm(p, me) : true));
    const ids = new Set(projects.map((p) => p.id));
    let tasks = data.tasks.filter((t) => ids.has(t.parent_id) && t.state !== 'cancelled' && (manager || isMine(t, me.id)));
    if (projectFilter) tasks = tasks.filter((t) => t.parent_id === projectFilter);
    if (personFilter) tasks = tasks.filter((t) => (t.assignee_id ?? t.assignee_open_id) === personFilter);
    if (healthFilter) tasks = tasks.filter((t) => t.health === healthFilter || (healthFilter === 'amber' && t.health === 'red'));
    if (hideDone) tasks = tasks.filter((t) => t.state !== 'done');
    return { tasks, projects: projectFilter ? projects.filter((p) => p.id === projectFilter) : projects };
  }, [data, manager, me, projectFilter, personFilter, healthFilter, hideDone]);

  const checkins = useMemo(() => {
    if (manager) return [] as { date: string; task: Task; pct: number }[];
    return scope.tasks.filter((t) => t.state === 'doing').flatMap((t) => checkinDates(t.start_date, t.due_date, tierOf({ startDate: t.start_date, dueDate: t.due_date, tier: t.tier }), calendar).map((c) => ({ date: c.date, task: t, pct: c.pct })));
  }, [scope.tasks, manager, calendar]);

  if (loading && !data) return <PageSkeleton kind="calendar" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const month = day.slice(0, 7);
  const [yy, mm] = month.split('-').map(Number);
  const week = weekOf(day);
  const step = (n: number) => setAnchor(view === 'month' ? `${shiftMonth(month, n)}-01` : shiftKey(day, n * 7));
  const tasksOn = (d: string) => scope.tasks.filter((t) => t.due_date === d);
  const projectsOn = (d: string) => scope.projects.filter((p) => p.due_date === d && p.state === 'active');
  const checkinsOn = (d: string) => checkins.filter((c) => c.date === d);

  const draggableTask = (t: Task) => canDrag && isProjectPm(t.project, me) && (t.state === 'doing' || t.state === 'changes' || t.state === 'review');
  const draggedTask = drag?.kind === 'task' ? data.tasks.find((x) => x.id === drag.id) ?? null : null;
  const draggedProject = drag?.kind === 'project' ? data.projects.find((x) => x.id === drag.id) ?? null : null;
  const fromDate = draggedTask?.due_date ?? draggedProject?.due_date ?? null;
  /** Why the dragged item cannot land on day d (null = it can). */
  const dropBlock = (d: string): string | null => {
    if (d < today) return 'Ngày đã qua';
    if (draggedTask && d > draggedTask.project.due_date) return `Sau deadline dự án ${fmtDueDate(draggedTask.project.due_date).slice(0, 5)}`;
    if (draggedProject) {
      if (d <= draggedProject.start_date) return 'Trước ngày bắt đầu dự án';
      const late = data.tasks.filter((t) => t.parent_id === draggedProject.id && (t.state === 'doing' || t.state === 'review' || t.state === 'changes') && t.due_date > d).length;
      if (late) return `${late} task có deadline sau ngày này`;
    }
    return null;
  };
  const startDrag = (next: Drag) => (e: DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', next.id);
    // Change the DOM a tick later: Chrome cancels a drag whose source re-renders inside dragstart.
    window.setTimeout(() => setDrag(next), 0);
  };
  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };
  const onDrop = (d: string) => (e: DragEvent) => {
    e.preventDefault();
    const block = dropBlock(d);
    if (block) toast(block, 'bad');
    else if (draggedTask && draggedTask.due_date !== d) setDropTask({ task: draggedTask, to: d });
    else if (draggedProject && draggedProject.due_date !== d) setDropProject({ project: draggedProject, to: d });
    endDrag();
  };
  /** key = the cell being hovered (a day, or person|day in the people view). */
  const dropProps = (key: string, d: string, accept = true) =>
    canDrag && drag && accept
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = dropBlock(d) ? 'none' : 'move';
            if (over !== key) setOver(key);
          },
          onDrop: onDrop(d),
        }
      : {};
  const isTarget = (key: string, d: string) => !!drag && over === key && d !== fromDate;
  const targetCls = (key: string, d: string) => (isTarget(key, d) ? (dropBlock(d) ? 'bg-bad-soft/60 ring-2 ring-inset ring-bad' : 'bg-brand-soft/70 ring-2 ring-inset ring-brand') : drag ? 'transition-colors' : '');
  const preview = (d: string): ReactNode => {
    const block = dropBlock(d);
    const label = draggedTask ? (
      <>
        <span className="font-mono text-[11.5px] opacity-70">{draggedTask.code.split('-').pop()}</span> {draggedTask.name}
      </>
    ) : draggedProject ? (
      <>Deadline {draggedProject.code}</>
    ) : null;
    if (!label) return null;
    return (
      <div className="cal-preview pointer-events-none" aria-hidden>
        <div>
          <div
            className={cx(
              'flex min-w-0 items-center gap-1.5 rounded-[5px] border border-dashed px-1.5 py-[3px] text-[12.5px] leading-tight shadow-lift',
              block ? 'border-bad bg-white text-bad' : draggedProject ? 'border-white/60 font-semibold text-white' : 'border-brand bg-white text-ink',
            )}
            style={!block && draggedProject ? { background: draggedProject.color ?? '#2F5BD3' } : undefined}
          >
            <Icon name={block ? 'x' : 'calendar'} size={11} className="shrink-0" />
            <span className="truncate">{block ?? label}</span>
          </div>
        </div>
      </div>
    );
  };

  const chipTask = (t: Task, compact = false) => (
    <button
      key={t.id}
      type="button"
      draggable={draggableTask(t)}
      onDragStart={startDrag({ kind: 'task', id: t.id })}
      onDragEnd={endDrag}
      onClick={() => open(t)}
      title={`${t.code} ${t.name}\n${t.assignee_name ?? ''}\n${HEALTH_LABEL[t.health]}: ${t.reason}`}
      className={cx('flex w-full min-w-0 items-center gap-1.5 rounded-[5px] border border-l-[3px] border-line bg-white px-1.5 py-[3px] text-left text-[12.5px] leading-tight text-ink hover:border-ink-3', HEALTH_EDGE[t.health], t.state === 'done' && 'opacity-60', draggableTask(t) && 'cursor-grab active:cursor-grabbing', drag?.id === t.id && 'border-dashed opacity-40')}
    >
      <ProjectSwatch color={t.project.color} className="h-2 w-2" />
      <span className="truncate">
        <span className="font-mono text-[11.5px] text-ink-3">{t.code.split('-').pop()}</span> {t.name}
        {!compact && manager && <span className="text-ink-3"> ({t.assignee_name?.split(' ').pop()})</span>}
      </span>
    </button>
  );
  const chipProject = (p: Project) => (
    <Link
      key={p.id}
      to={`/du-an/${encodeURIComponent(p.code)}`}
      draggable={canDrag && isProjectPm(p, me)}
      onDragStart={startDrag({ kind: 'project', id: p.id })}
      onDragEnd={endDrag}
      title={`Deadline dự án ${p.code}: ${p.name}`}
      className={cx('flex min-w-0 items-center gap-1.5 rounded-[5px] px-1.5 py-[3px] text-[12.5px] font-semibold leading-tight text-white', canDrag && isProjectPm(p, me) && 'cursor-grab active:cursor-grabbing', drag?.id === p.id && 'opacity-40')}
      style={{ background: p.color ?? '#2F5BD3' }}
    >
      <Icon name="star" size={11} className="shrink-0" />
      <span className="truncate">Deadline {p.code}</span>
    </Link>
  );
  const chipCheckin = (c: { task: Task; pct: number }) => (
    <button key={`${c.task.id}-${c.pct}`} type="button" onClick={() => open(c.task, 'progress')} className="flex w-full items-center gap-1 truncate rounded-[5px] border border-dashed border-brand-line px-1.5 py-[2px] text-left text-[11.5px] text-brand hover:bg-brand-soft">
      <Icon name="ask" size={12} className="shrink-0" /> Hỏi tiến độ {c.task.code.split('-').pop()}
    </button>
  );

  const cellItems = (d: string, limit: number, key = d) => {
    const head = [...projectsOn(d).map((p) => ({ k: `p${p.id}`, node: chipProject(p) })), ...checkinsOn(d).map((c) => ({ k: `c${c.task.id}-${c.pct}`, node: chipCheckin(c) }))];
    const body = tasksOn(d).map((t) => ({ k: `t${t.id}`, node: chipTask(t) }));
    const showPreview = isTarget(key, d);
    // The preview lands where the item will sit: a project deadline on top, a task first among the tasks.
    const at = draggedProject ? 0 : head.length;
    const items: { k: string; node: ReactNode; pushed?: boolean }[] = [...head, ...body];
    if (showPreview) {
      items.splice(at, 0, { k: '__preview', node: preview(d) });
      for (let i = at + 1; i < items.length; i++) items[i] = { ...items[i], pushed: true };
    }
    const open_ = expanded === d;
    const shown = open_ ? items : items.slice(0, limit);
    return (
      <>
        {shown.map((x) => (
          <div key={x.k} className={x.pushed ? 'cal-pushed' : undefined}>
            {x.node}
          </div>
        ))}
        {items.length > limit && (
          <button type="button" className="text-left text-[12px] font-semibold text-ink-3 hover:text-ink" onClick={() => setExpanded(open_ ? null : d)}>
            {open_ ? 'Thu gọn' : `+${items.length - limit} mục`}
          </button>
        )}
      </>
    );
  };

  const people = manager
    ? [...new Map(scope.tasks.map((t) => [t.assignee_id ?? t.assignee_open_id ?? '—', t.assignee_name ?? '—'])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
    : [];
  const allPeople = manager ? [...new Map(data.tasks.map((t) => [t.assignee_id ?? t.assignee_open_id ?? '—', t.assignee_name ?? '—'])).entries()] : [];

  const title = view === 'month' ? `${MONTHS[mm - 1]}, ${yy}` : weekLabel(week);
  const showsToday = view === 'month' ? today.slice(0, 7) === month : today >= week[0] && today <= week[6];
  const views: [View, string][] = manager
    ? [
        ['month', 'Tháng'],
        ['people', 'Tuần theo người'],
      ]
    : [
        ['week', 'Tuần'],
        ['month', 'Tháng'],
      ];

  return (
    <div>
      {/* header: ‹ period › on the left; Hôm nay sits with the view switch, away from the arrows */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton icon="chevronRight" label={view === 'month' ? 'Tháng trước' : 'Tuần trước'} className="rotate-180 rounded-full border border-line-edge bg-paper" onClick={() => step(-1)} />
          <h1 aria-live="polite" className="min-w-[200px] px-2 text-center text-[26px] font-semibold leading-none tracking-[-0.01em] text-ink sm:min-w-[240px] sm:text-[30px]">
            {title}
          </h1>
          <IconButton icon="chevronRight" label={view === 'month' ? 'Tháng sau' : 'Tuần sau'} className="rounded-full border border-line-edge bg-paper" onClick={() => step(1)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" icon="calendar" disabled={showsToday} onClick={() => setAnchor(null)} title={`Về ${view === 'month' ? 'tháng' : 'tuần'} có hôm nay (${fmtDueDate(today)})`}>
            Hôm nay
          </Button>
          <div role="tablist" aria-label="Chế độ xem" className="flex rounded-lg bg-ink/[0.06] p-1">
            {views.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cx('min-h-[32px] rounded-md px-3 text-[13.5px] font-medium', view === k ? 'bg-white text-ink shadow-sheet' : 'text-ink-2 hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Dự án" className="min-w-[180px]">
          {(id) => (
            <Select id={id} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">Tất cả</option>
              {data.projects
                .filter((p) => p.state !== 'cancelled')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} {p.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        {manager && (
          <>
            <Field label="Nhân sự" className="min-w-[180px]">
              {(id) => (
                <Select id={id} value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
                  <option value="">Tất cả</option>
                  {allPeople.map(([k, n]) => (
                    <option key={k} value={k}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Sức khoẻ" className="min-w-[160px]">
              {(id) => (
                <Select id={id} value={healthFilter} onChange={(e) => setHealthFilter(e.target.value as '' | 'red' | 'amber')}>
                  <option value="">Tất cả</option>
                  <option value="red">Cần can thiệp</option>
                  <option value="amber">Có nguy cơ trở lên</option>
                </Select>
              )}
            </Field>
          </>
        )}
        <label className="flex min-h-[40px] items-center gap-2 text-[14px] text-ink-2">
          <input type="checkbox" className="h-4 w-4" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Ẩn task đã xong
        </label>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {/* desktop grids */}
          <div
            className="hidden overflow-hidden rounded-xl border border-line bg-white shadow-sheet md:block"
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
          >
            {view === 'month' && (
              <>
                <div className="grid grid-cols-7 border-b border-line text-[12.5px] font-medium text-ink-3">
                  {WEEKDAYS.map((w) => (
                    <div key={w} className="px-2.5 py-2">
                      {w}
                    </div>
                  ))}
                </div>
                {monthGrid(month).map((wk) => (
                  <div key={wk[0]} className="grid grid-cols-7 border-b border-line-soft last:border-b-0">
                    {wk.map((d) => (
                      <div key={d} {...dropProps(d, d)} className={cx('min-h-[118px] border-r border-line-soft p-1.5 last:border-r-0', d.slice(0, 7) !== month && 'bg-canvas/60', targetCls(d, d))}>
                        <DayNumber d={d} today={today} dim={d.slice(0, 7) !== month} />
                        <div className="mt-1 flex flex-col gap-1">{cellItems(d, 3)}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
            {view === 'week' && (
              <div className="grid grid-cols-7">
                {week.map((d) => (
                  <div key={d} {...dropProps(d, d)} className={cx('min-h-[420px] border-r border-line-soft last:border-r-0', targetCls(d, d))}>
                    <div className={cx('border-b border-line px-2.5 py-2 text-[12.5px] font-semibold', d === today ? 'text-brand' : 'text-ink-3')}>
                      {WEEKDAYS[week.indexOf(d)]} {d.slice(8)}
                    </div>
                    <div className="flex flex-col gap-1 p-1.5">{cellItems(d, 12)}</div>
                  </div>
                ))}
              </div>
            )}
            {view === 'people' && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] table-fixed text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[12.5px] text-ink-3">
                      <th className="w-40 px-2.5 py-2 font-medium">Nhân sự</th>
                      {week.map((d, i) => (
                        <th key={d} className={cx('px-2 py-2 font-medium', d === today && 'text-brand')}>
                          {WEEKDAYS[i]} {d.slice(8)}/{d.slice(5, 7)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map(([pid, name]) => (
                      <tr key={pid} className="border-b border-line-soft align-top">
                        <td className="px-2.5 py-2 font-medium text-ink">{name}</td>
                        {week.map((d) => {
                          const items = scope.tasks.filter((t) => (t.assignee_id ?? t.assignee_open_id ?? '—') === pid && t.due_date === d);
                          const key = `${pid}|${d}`;
                          // Dragging only moves the date, never the person: accept drops on the assignee's own row.
                          const own = !!draggedTask && (draggedTask.assignee_id ?? draggedTask.assignee_open_id ?? '—') === pid;
                          const target = own && isTarget(key, d);
                          return (
                            <td key={d} {...dropProps(key, d, own)} className={cx('border-l border-line-soft p-1', LOAD_BG[loadLevel(items.filter((t) => t.state !== 'done').length)], own ? targetCls(key, d) : drag && 'opacity-50')}>
                              <div className="flex flex-col gap-1">
                                {target && preview(d)}
                                {items.map((t) => (
                                  <div key={t.id} className={target ? 'cal-pushed' : undefined}>
                                    {chipTask(t, true)}
                                  </div>
                                ))}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {!people.length && (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-ink-3">
                          Không có task trong phạm vi lọc.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* phones: agenda list (PRD 8.4), no drag */}
          <div className="md:hidden">
            <Agenda days={view === 'month' ? monthGrid(month).flat().filter((d) => d.slice(0, 7) === month) : week} today={today} render={(d) => [...projectsOn(d).map(chipProject), ...checkinsOn(d).map(chipCheckin), ...tasksOn(d).map((t) => chipTask(t))]} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded-[3px] bg-[#2F5BD3]" /> Deadline dự án (chip đặc)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-5 rounded-[3px] border border-l-[3px] border-line border-l-ok bg-white" /> Task (chip viền, viền trái theo sức khoẻ)
            </span>
            {canDrag ? <span>Kéo task sang ngày khác để gia hạn.</span> : null}
          </div>
        </div>

        <aside className="flex flex-col gap-4">{manager ? <PmPanel data={scope} today={today} allTasks={data.tasks} onOpen={open} /> : <StaffPanel tasks={scope.tasks} projects={scope.projects} checkins={checkins} today={today} week={week} />}</aside>
      </div>

      <TaskHost data={data} reload={reload} />
      {dropTask && <ExtendDialog task={dropTask.task} to={dropTask.to} today={today} onClose={() => setDropTask(null)} onDone={() => (setDropTask(null), reload())} />}
      {dropProject && <ProjectDueDialog project={dropProject.project} to={dropProject.to} onClose={() => setDropProject(null)} onDone={() => (setDropProject(null), reload())} />}
    </div>
  );
}

function DayNumber({ d, today, dim }: { d: string; today: string; dim?: boolean }) {
  const n = Number(d.slice(8));
  return d === today ? <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-brand text-[13px] font-semibold text-white">{n}</span> : <span className={cx('inline-block px-1 text-[13px] font-medium', dim ? 'text-ink-3/60' : 'text-ink')}>{n}</span>;
}

function Agenda({ days, today, render }: { days: string[]; today: string; render: (d: string) => ReactNode[] }) {
  const rows = days.map((d) => [d, render(d)] as const).filter(([, items]) => items.length);
  if (!rows.length) return <p className="py-6 text-center text-[14px] text-ink-3">Không có mục nào trong khoảng này.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(([d, items]) => (
        <li key={d} className="rounded-xl border border-line bg-white p-3">
          <div className={cx('mb-2 text-[13px] font-semibold', d === today ? 'text-brand' : 'text-ink-2')}>
            {d === today ? 'Hôm nay, ' : ''}
            {fmtDueDate(d)}
          </div>
          <div className="flex flex-col gap-1.5">
            {items.map((x, i) => (
              <div key={i}>{x}</div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PanelCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-4 shadow-sheet">
      <h2 className="mb-2 text-[15px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function StaffPanel({ tasks, projects, checkins, today, week }: { tasks: Task[]; projects: Project[]; checkins: { date: string; task: Task; pct: number }[]; today: string; week: string[] }) {
  const open = tasks.filter((t) => t.state === 'doing' || t.state === 'changes');
  const due = open.filter((t) => t.due_date >= week[0] && t.due_date <= week[6]);
  const over = open.filter((t) => t.due_date < today);
  const asks = checkins.filter((c) => c.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  return (
    <>
      <PanelCard title="Tuần này">
        <p className="text-[30px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {due.length} <span className="text-[14px] font-normal text-ink-3">task đến hạn</span>
        </p>
        {over.length > 0 && <p className="mt-1 text-[14px] font-semibold text-bad">{over.length} task đang quá hạn</p>}
        <div className="mt-3 border-t border-line-soft pt-2">
          <div className="mb-1 text-[12.5px] font-semibold text-ink-3">Hỏi tiến độ sắp tới</div>
          {asks.length ? (
            <ul className="flex flex-col gap-1 text-[13.5px]">
              {asks.map((c) => (
                <li key={`${c.task.id}-${c.pct}`}>
                  {fmtDueDate(c.date).slice(0, 5)} <span className="font-mono text-[12.5px] text-brand">{c.task.code}</span> (mốc {c.pct}%)
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-ink-3">Không có.</p>
          )}
        </div>
      </PanelCard>
      <PanelCard title="Dự án">
        <ul className="flex flex-col gap-1.5 text-[13.5px]">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <ProjectSwatch color={p.color} />
              <Link to={`/du-an/${encodeURIComponent(p.code)}`} className="truncate hover:underline">
                {p.code} {p.name}
              </Link>
            </li>
          ))}
          {!projects.length && <li className="text-ink-3">Chưa có.</li>}
        </ul>
      </PanelCard>
    </>
  );
}

function PmPanel({ data, today, allTasks, onOpen }: { data: { tasks: Task[]; projects: Project[] }; today: string; allTasks: Task[]; onOpen: (t: Task) => void }) {
  const review = allTasks.filter((t) => t.state === 'review' && data.projects.some((p) => p.id === t.parent_id));
  const week = weekOf(today);
  const red = data.tasks.filter((t) => t.health === 'red' && t.due_date <= week[6]);
  const soon = data.projects.filter((p) => p.state === 'active' && daysBetween(today, p.due_date) >= 0 && daysBetween(today, p.due_date) <= 14).sort((a, b) => a.due_date.localeCompare(b.due_date));
  return (
    <>
      <PanelCard title="Chờ duyệt">
        <p className="text-[30px] font-semibold leading-none tracking-[-0.02em] text-ink">{review.length}</p>
        <Link to="/cho-duyet" className="mt-2 inline-block text-[13.5px] font-semibold text-brand underline">
          Mở trang Chờ duyệt
        </Link>
      </PanelCard>
      <PanelCard title="Cần can thiệp tuần này">
        {red.length ? (
          <ul className="flex flex-col gap-1.5 text-[13.5px]">
            {red.map((t) => (
              <li key={t.id}>
                <button type="button" className="flex items-start gap-2 text-left hover:text-brand" onClick={() => onOpen(t)}>
                  <HealthDot health={t.health} className="mt-1.5" />
                  <span>
                    <span className="font-mono text-[12.5px] text-brand">{t.code}</span> {t.name}
                    <span className="block text-[12.5px] text-ink-3">{t.reason}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-ink-3">Không có.</p>
        )}
      </PanelCard>
      <PanelCard title="Deadline dự án trong 14 ngày tới">
        {soon.length ? (
          <ul className="flex flex-col gap-1.5 text-[13.5px]">
            {soon.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <ProjectSwatch color={p.color} />
                <Link to={`/du-an/${encodeURIComponent(p.code)}`} className="truncate hover:underline">
                  {fmtDueDate(p.due_date).slice(0, 5)}: {p.code}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-ink-3">Không có.</p>
        )}
      </PanelCard>
    </>
  );
}

function ExtendDialog({ task, to, today, onClose, onDone }: { task: Task; to: string; today: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<ExtendReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const errs = extensionErrors({ dueDate: task.due_date }, to, reason || null, task.project.due_date, today);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Gia hạn ${task.code}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            busy={busy}
            disabled={errs.length > 0}
            onClick={() => {
              setBusy(true);
              callApi('work.extend', { task_id: task.id, to, reason, note })
                .then(() => (toast(`Đã gia hạn ${task.code}`), onDone()), (e) => toast(e.message, 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            Gia hạn
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[14.5px] text-ink">
        {task.name}: <b>{fmtDueDate(task.due_date)}</b> → <b>{fmtDueDate(to)}</b>
      </p>
      <div className="flex flex-col gap-3">
        {task.due_date < today && <Banner tone="warn">Task quá hạn từ {fmtDueDate(task.kpi_due_date ?? task.due_date)}. Gia hạn không xoá việc trễ, trừ khi do yêu cầu thay đổi.</Banner>}
        <Field label="Vì sao phải gia hạn?" hint="Quyết định task có bị tính trễ không.">
          {() => <ExtendReasonPicker value={reason} onChange={setReason} newDue={to} kpiDue={task.kpi_due_date ?? task.due_date} />}
        </Field>
        <Field label="Ghi chú (không bắt buộc)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {reason && errs.length > 0 && <p className="text-[13px] text-bad">{errs.join(' ')}</p>}
        {!reason && to > task.project.due_date && <p className="text-[13px] text-bad">Ngày này sau deadline dự án ({fmtDueDate(task.project.due_date)}): gia hạn dự án trước.</p>}
      </div>
    </Modal>
  );
}

function ProjectDueDialog({ project, to, onClose, onDone }: { project: Project; to: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<ExtendReason | ''>('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Đổi deadline dự án ${project.code}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            busy={busy}
            disabled={!reason}
            onClick={() => {
              setBusy(true);
              callApi('work.project_update', { project_id: project.id, due_date: to, reason })
                .then(() => (toast(`Đã đổi deadline ${project.code}`), onDone()), (e) => toast(e.message, 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            Đổi deadline
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[14.5px]">
        <b>{fmtDueDate(project.due_date)}</b> → <b>{fmtDueDate(to)}</b>
      </p>
      <Field label="Vì sao đổi deadline dự án?" hint="Deadline từng task không tự đổi.">
        {() => <ExtendReasonPicker value={reason} onChange={setReason} newDue={to} kpiDue={project.kpi_due_date ?? project.due_date} subject="project" />}
      </Field>
    </Modal>
  );
}

/** "16 – 22/11/2026", "30/11 – 06/12/2026", "29/12/2026 – 04/01/2027". */
function weekLabel(week: string[]): string {
  const [a, b] = [week[0], week[6]];
  const dm = (k: string) => `${k.slice(8)}/${k.slice(5, 7)}`;
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${dm(a)}/${a.slice(0, 4)} – ${dm(b)}/${b.slice(0, 4)}`;
  if (a.slice(0, 7) !== b.slice(0, 7)) return `${dm(a)} – ${dm(b)}/${b.slice(0, 4)}`;
  return `${a.slice(8)} – ${dm(b)}/${b.slice(0, 4)}`;
}
