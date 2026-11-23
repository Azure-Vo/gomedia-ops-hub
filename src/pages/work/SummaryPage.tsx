import { Link, useNavigate } from 'react-router-dom';
import { fmtDueDate, localDateKey, PROGRESS_LABEL, sortSummary, summarizeProject, SummaryProject, SummaryTask } from '@/domain';
import { Badge, Button, cx, EmptyState, ErrorBox, Icon, IconName, PageHeader, Stat, useAsync, PageSkeleton } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { loadWonQuotes, Task, WorkData } from './data';
import { TaskHost, useOpenTask, useWork } from './hooks';
import { ProgressBar, ProjectStatusBadge, ProjectSwatch } from './parts';

export function toSummaryTask(t: Task, tz: string): SummaryTask {
  const day = (s: string | null) => (s ? localDateKey(Date.parse(s), tz) : null);
  return {
    code: t.code,
    name: t.name,
    state: t.state,
    dueDate: t.due_date,
    health: t.health,
    reason: t.reason,
    progress: t.progress,
    noUpdate: t.noUpdate,
    reviewSince: day(t.review_since),
    submittedOn: t.state === 'review' ? day(t.review_since) : null,
    approvedOn: day(t.approved_at),
  };
}

export function buildSummary(data: WorkData, tz: string, cal: Parameters<typeof summarizeProject>[3], onlyPmId?: string): SummaryProject[] {
  return sortSummary(
    data.projects
      .filter((p) => p.state === 'active' && (!onlyPmId || p.pm_id === onlyPmId || !p.pm_id))
      .map((p) => summarizeProject({ code: p.code, name: p.name, status: p.rollup.status, reason: p.rollup.reason }, p.tasks.map((t) => toSummaryTask(t, tz)), data.today, cal)),
  );
}

/** PRD 7.6 · luôn là số mới nhất; bản tin 08:30 và 17:30 trên Lark là ảnh chụp của trang này. */
export function SummaryPage() {
  const me = useProfile();
  const { calendar, tz, settings } = useSettings();
  const { data, loading, error, reload } = useWork();
  const { open } = useOpenTask(data);
  if (loading && !data) return <PageSkeleton kind="stats" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const list = buildSummary(data, tz, calendar, me.role === 'pm' ? me.id : undefined);
  const byCode = new Map(data.tasks.map((t) => [t.code, t]));
  const sum = (f: (s: SummaryProject) => number) => list.reduce((n, s) => n + f(s), 0);
  const openTask = (code: string) => {
    const t = byCode.get(code);
    if (t) open(t);
  };
  return (
    <div>
      <PageHeader
        title="Tóm tắt hôm nay"
        subtitle={`${weekdayLabel(data.today)}, ${fmtDueDate(data.today)}. Bot gửi bản tin lúc ${settings?.summary_morning_time ?? '08:30'}${settings?.summary_evening_on === false ? '' : ` và ${settings?.summary_evening_time ?? '17:30'}`}`}
      />
      <div className="mb-7 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Quá hạn" value={sum((s) => s.overdue.length)} tone={sum((s) => s.overdue.length) ? 'bad' : null} />
        <Stat label="Đến hạn hôm nay" value={sum((s) => s.dueToday.length)} />
        <Stat label="Chờ duyệt" value={sum((s) => s.review.length)} />
        <Stat label="Bị chặn" value={sum((s) => s.blocked.length)} tone={sum((s) => s.blocked.length) ? 'bad' : null} />
        <Stat label="Chậm / chưa cập nhật" value={sum((s) => s.behind.length + s.noUpdate.length)} />
      </div>
      <InvitationNotes data={data} pmId={me.role === 'pm' ? me.id : undefined} />
      <WonQuotesNote />
      {!list.length ? (
        <EmptyState title="Không có dự án nào đang chạy">{me.role === 'pm' ? <Link className="underline" to="/du-an">Tạo dự án</Link> : null}</EmptyState>
      ) : (
        <ProjectBoard list={list} data={data} onOpen={openTask} />
      )}
      <p className="mt-8 text-[13px] text-ink-3">
        Lần chạy nhắc việc gần nhất: {settings?.lark_status && (settings.lark_status as { at?: string }).at ? timeAgo((settings.lark_status as { at: string }).at) : 'chưa có'}. Lịch sử các bản tóm tắt đã gửi xem ở <Link className="underline" to="/dashboard">Báo cáo</Link>.
      </p>
      <TaskHost data={data} reload={reload} />
    </div>
  );
}

/** Answers to the PM's invitations: declines (with the reason) from the last 7 days, and invitations still open. */
function InvitationNotes({ data, pmId }: { data: WorkData; pmId?: string }) {
  const weekAgo = Date.now() - 7 * 86_400_000;
  const mine = data.projects.filter((p) => p.state === 'active' && (!pmId || p.pm_id === pmId || !p.pm_id));
  const declined = mine.flatMap((p) => p.members.filter((m) => m.status === 'declined' && m.responded_at && Date.parse(m.responded_at) >= weekAgo).map((m) => ({ p, m })));
  const waiting = mine.flatMap((p) => p.members.filter((m) => m.status === 'invited').map((m) => ({ p, m })));
  if (!declined.length && !waiting.length) return null;
  return (
    <section className="mb-7 grid gap-4 md:grid-cols-2">
      {declined.length > 0 && (
        <div className="rounded-2xl border border-bad-line bg-paper p-5">
          <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Icon name="userX" size={17} className="text-bad" /> Lời mời bị từ chối trong 7 ngày <Badge tone="bad">{declined.length}</Badge>
          </div>
          <ul className="flex flex-col divide-y divide-line text-[14px]">
            {declined.map(({ p, m }) => (
              <li key={m.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2.5">
                  <b>{m.name}</b>
                  <Link className="font-mono text-[13px] text-brand hover:underline" to={`/du-an/${encodeURIComponent(p.code)}`}>{p.code}</Link>
                </div>
                <div className="mt-0.5 text-[13.5px] text-ink-2">Lý do: {m.decline_reason || 'không ghi'}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {waiting.length > 0 && (
        <div className="rounded-2xl border border-line bg-paper p-5">
          <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Icon name="userPlus" size={17} className="text-ink-2" /> Lời mời chưa trả lời <Badge tone="brand">{waiting.length}</Badge>
          </div>
          <ul className="flex flex-col divide-y divide-line text-[14px]">
            {waiting.map(({ p, m }) => (
              <li key={m.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <Link className="font-mono text-[13px] text-brand hover:underline" to={`/du-an/${encodeURIComponent(p.code)}`}>{p.code}</Link>
                {m.invited_at && <span className="w-20 text-right text-[12.5px] text-ink-3">mời {fmtDueDate(m.invited_at.slice(0, 10)).slice(0, 5)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function weekdayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][d];
}

type Need = 'overdue' | 'blocked' | 'dueToday' | 'review' | 'behind' | 'noUpdate';
/** What the PM has to do about a task, most urgent first. */
const NEED: Record<Need, { label: string; icon: IconName; chip: string }> = {
  overdue: { label: 'Quá hạn', icon: 'alert', chip: 'bg-bad-soft text-bad' },
  blocked: { label: 'Bị chặn', icon: 'ban', chip: 'bg-bad-soft text-bad' },
  dueToday: { label: 'Đến hạn hôm nay', icon: 'clock', chip: 'bg-warn-soft text-warn' },
  review: { label: 'Chờ bạn duyệt', icon: 'listChecks', chip: 'bg-brand-soft text-brand' },
  behind: { label: 'Báo chậm', icon: 'trendingDown', chip: 'bg-warn-soft text-warn' },
  noUpdate: { label: 'Chưa cập nhật', icon: 'ask', chip: 'bg-line-soft text-ink-2' },
};
const NEED_ORDER: Need[] = ['overdue', 'blocked', 'dueToday', 'review', 'behind', 'noUpdate'];

function needRows(s: SummaryProject, today: string) {
  const seen = new Set<string>();
  const rows: { need: Need; t: SummaryTask; detail: string }[] = [];
  const detail = (need: Need, t: SummaryTask): string => {
    if (need === 'overdue') return `Trễ ${Math.max(1, Math.round((Date.parse(today) - Date.parse(t.dueDate)) / 86400000))} ngày, hạn ${fmtDueDate(t.dueDate).slice(0, 5)}`;
    if (need === 'blocked') return t.reason.replace(/^Bị chặn:?\s*/, '') || 'Người làm báo bị chặn';
    if (need === 'dueToday') return 'Hạn hôm nay';
    if (need === 'review') {
      const d = (t as SummaryTask & { waitDays: number }).waitDays;
      return d ? `Đã chờ ${d} ngày làm việc` : 'Nộp hôm nay';
    }
    if (need === 'behind') return `${PROGRESS_LABEL.behind}, hạn ${fmtDueDate(t.dueDate).slice(0, 5)}`;
    return 'Chưa trả lời câu hỏi tiến độ';
  };
  for (const need of NEED_ORDER) {
    for (const t of s[need]) {
      if (seen.has(t.code)) continue;
      seen.add(t.code);
      rows.push({ need, t, detail: detail(need, t) });
    }
  }
  return rows;
}

/** PM view: projects that need action as cards with one row per task to act on; quiet projects as a compact grid. */
function ProjectBoard({ list, data, onOpen }: { list: SummaryProject[]; data: WorkData; onOpen: (code: string) => void }) {
  const project = (code: string) => data.projects.find((x) => x.code === code)!;
  const byCode = new Map(data.tasks.map((t) => [t.code, t]));
  const busy = list.map((s) => ({ s, rows: needRows(s, data.today) })).filter((x) => x.rows.length);
  const quiet = list.filter((s) => !busy.some((b) => b.s.code === s.code));
  return (
    <div className="flex flex-col gap-8">
      {busy.length > 0 && (
        <section aria-label="Dự án cần xử lý">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold text-ink">
            Cần xử lý <span className="text-[15px] font-medium text-ink-3">{busy.length} dự án</span>
          </h2>
          <div className="flex flex-col gap-4">
            {busy.map(({ s, rows }) => {
              const p = project(s.code);
              return (
                <article key={s.code} className="overflow-hidden rounded-2xl border border-line bg-paper">
                  <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-5 py-4">
                    <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ProjectSwatch color={p.color} />
                        <Link to={`/du-an/${encodeURIComponent(s.code)}`} className="font-mono text-[14px] font-semibold text-brand underline-offset-2 hover:underline">
                          {s.code}
                        </Link>
                        <Link to={`/du-an/${encodeURIComponent(s.code)}`} className="text-[17px] font-semibold text-ink hover:underline">
                          {s.name}
                        </Link>
                        <ProjectStatusBadge status={s.status} />
                      </div>
                      <div className="text-[13px] text-ink-3">
                        Deadline {fmtDueDate(p.due_date)}, đã đi {p.rollup.timePct}% thời gian
                      </div>
                    </div>
                    <ProgressBar r={p.rollup} compact className="w-full sm:w-72" />
                  </header>
                  <ul className="divide-y divide-line">
                    {rows.map(({ need, t, detail }) => {
                      const k = NEED[need];
                      const who = byCode.get(t.code)?.assignee_name;
                      return (
                        <li key={t.code}>
                          <button type="button" onClick={() => onOpen(t.code)} className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3 text-left transition-colors hover:bg-canvas/60 md:grid-cols-[164px_minmax(0,1fr)_160px_minmax(0,220px)_20px]">
                            <span className={cx('inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold', k.chip)}>
                              <Icon name={k.icon} size={14} />
                              {k.label}
                            </span>
                            <span className="col-span-2 min-w-0 md:col-span-1">
                              <span className="mr-2 font-mono text-[12.5px] text-brand">{t.code}</span>
                              <span className="text-[15px] font-medium text-ink group-hover:text-brand">{t.name}</span>
                            </span>
                            <span className="flex min-w-0 items-center gap-2 text-[13.5px] text-ink-2">
                              {who ? (
                                <>
                                  <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line-soft text-[10.5px] font-semibold text-ink">
                                    {initialsOf(who)}
                                  </span>
                                  <span className="truncate">{who}</span>
                                </>
                              ) : (
                                <span className="text-ink-3">Chưa giao</span>
                              )}
                            </span>
                            <span className={cx('text-[13.5px] md:text-right', need === 'overdue' || need === 'blocked' ? 'text-bad' : 'text-ink-2')}>{detail}</span>
                            <Icon name="chevronRight" size={16} className="hidden text-ink-3 group-hover:text-brand md:block" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {quiet.length > 0 && (
        <section aria-label="Dự án đang ổn">
          <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold text-ink">
            Không có việc cần xử lý <span className="text-[15px] font-medium text-ink-3">{quiet.length} dự án</span>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {quiet.map((s) => {
              const p = project(s.code);
              return (
                <li key={s.code}>
                  <Link to={`/du-an/${encodeURIComponent(s.code)}`} className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-paper px-4 py-3.5 transition-colors hover:border-line-control">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ProjectSwatch color={p.color} />
                          <span className="font-mono text-[13px] font-semibold text-brand">{s.code}</span>
                        </div>
                        <div className="mt-0.5 truncate text-[15px] font-semibold text-ink">{s.name}</div>
                      </div>
                      <ProjectStatusBadge status={s.status} />
                    </div>
                    {p.rollup.total ? <ProgressBar r={p.rollup} compact /> : <div className="text-[13px] text-ink-3">Chưa có task</div>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

/** 1.7 · Quotes the client accepted that are waiting for a project (the PM they were handed to). */
function WonQuotesNote() {
  const me = useProfile();
  const nav = useNavigate();
  const won = useAsync(() => loadWonQuotes(me), [me.id]);
  const list = won.data ?? [];
  if (!list.length) return null;
  const days = (at: string | null) => (at ? Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 86400000)) : 0);
  return (
    <section className="mb-7 rounded-2xl border border-ok-line bg-paper p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Icon name="handshake" size={17} className="text-ok" /> Báo giá đã chốt, chưa có dự án <Badge tone="ok">{list.length}</Badge>
      </h2>
      <ul className="flex flex-col gap-1.5">
        {list.map((q) => (
          <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
            <Link to={`/quotes/${q.id}`} className="font-semibold text-brand hover:underline">
              {q.code}
            </Link>
            <span className="text-ink">{q.client || '(chưa có khách)'}</span>
            {q.kind === 'project' && <Badge tone="accent">Dự án</Badge>}
            <span className="text-[13px] text-ink-3">chốt {days(q.outcome_at) ? `${days(q.outcome_at)} ngày trước` : 'hôm nay'}</span>
            {me.role === 'pm' && (
              <Button size="sm" className="ml-auto" onClick={() => nav(`/du-an?tu-bao-gia=${q.id}`)}>
                Tạo dự án
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
