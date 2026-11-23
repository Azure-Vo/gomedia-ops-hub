import { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtDueDate, localDateKey, PROGRESS_LABEL, sortSummary, summarizeProject, SummaryProject, SummaryTask } from '@/domain';
import { Badge, Button, cx, EmptyState, ErrorBox, Loading, PageHeader, Stat, useAsync } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { loadWonQuotes, Task, WorkData } from './data';
import { TaskHost, useOpenTask, useWork } from './hooks';
import { ProjectStatusBadge, ProjectSwatch } from './parts';

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
  if (loading && !data) return <Loading />;
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
        subtitle={`${fmtDueDate(data.today)} · bot gửi bản tin lúc ${settings?.summary_morning_time ?? '08:30'}${settings?.summary_evening_on === false ? '' : ` và ${settings?.summary_evening_time ?? '17:30'}`}`}
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
        <div className="flex flex-col gap-6">
          {list.map((s) => {
            const p = data.projects.find((x) => x.code === s.code)!;
            const quiet = !s.overdue.length && !s.dueToday.length && !s.review.length && !s.blocked.length && !s.behind.length && !s.noUpdate.length;
            return (
              <section key={s.code} className="border-t border-ink pt-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <ProjectSwatch color={p.color} />
                  <Link to={`/du-an/${encodeURIComponent(s.code)}`} className="font-mono text-[14px] font-semibold text-brand underline-offset-2 hover:underline">
                    {s.code}
                  </Link>
                  <b className="text-[16px] text-ink">{s.name}</b>
                  <ProjectStatusBadge status={s.status} />
                  <span className="text-[13px] text-ink-3">{s.reason}</span>
                </div>
                {quiet ? (
                  <p className="text-[14px] text-ink-3">Không có việc cần xử lý. {p.rollup.done}/{p.rollup.total} task đã duyệt.</p>
                ) : (
                  <div className="grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
                    <Bucket title="Quá hạn" tone="bad" items={s.overdue} onOpen={openTask} render={(t) => `quá ${Math.max(1, Math.round((Date.parse(data.today) - Date.parse(t.dueDate)) / 86400000))} ngày`} />
                    <Bucket title="Đến hạn hôm nay" items={s.dueToday} onOpen={openTask} />
                    <Bucket title="Chờ duyệt" tone="brand" items={s.review} onOpen={openTask} render={(t) => `chờ ${(t as SummaryTask & { waitDays: number }).waitDays} ngày làm việc`} />
                    <Bucket title="Bị chặn" tone="bad" items={s.blocked} onOpen={openTask} render={(t) => t.reason.replace(/^Bị chặn:?\s*/, '')} />
                    <Bucket title="Báo chậm" tone="warn" items={s.behind} onOpen={openTask} render={() => PROGRESS_LABEL.behind} />
                    <Bucket title="Chưa cập nhật" tone="warn" items={s.noUpdate} onOpen={openTask} render={() => 'chưa trả lời câu hỏi tiến độ'} />
                  </div>
                )}
              </section>
            );
          })}
        </div>
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
        <div className="rounded-xl border border-bad/30 bg-white p-4 shadow-sheet">
          <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            Lời mời bị từ chối · 7 ngày <Badge tone="bad">{declined.length}</Badge>
          </div>
          <ul className="flex flex-col gap-2 text-[14px]">
            {declined.map(({ p, m }) => (
              <li key={m.id}>
                <b>{m.name}</b> · <Link className="font-mono text-[13px] text-brand hover:underline" to={`/du-an/${encodeURIComponent(p.code)}`}>{p.code}</Link>
                <div className="text-[13.5px] text-ink-2">Lý do: {m.decline_reason || 'không ghi'}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {waiting.length > 0 && (
        <div className="rounded-xl border border-line bg-white p-4 shadow-sheet">
          <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
            Lời mời chưa trả lời <Badge tone="brand">{waiting.length}</Badge>
          </div>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {waiting.map(({ p, m }) => (
              <li key={m.id}>
                {m.name} · <Link className="font-mono text-[13px] text-brand hover:underline" to={`/du-an/${encodeURIComponent(p.code)}`}>{p.code}</Link>
                {m.invited_at && <span className="text-[12.5px] text-ink-3"> · mời {fmtDueDate(m.invited_at.slice(0, 10)).slice(0, 5)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Bucket({ title, items, onOpen, render, tone }: { title: string; items: SummaryTask[]; onOpen: (code: string) => void; render?: (t: SummaryTask) => ReactNode; tone?: 'bad' | 'warn' | 'brand' }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        {title} <Badge tone={tone ?? 'neutral'}>{items.length}</Badge>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((t) => (
          <li key={t.code}>
            <button type="button" className={cx('text-left text-[14px] hover:text-brand')} onClick={() => onOpen(t.code)}>
              <span className="mr-1.5 font-mono text-[12.5px] text-brand">{t.code}</span>
              {t.name}
              {render && <span className="ml-1.5 text-[12.5px] text-ink-3">· {render(t)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
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
    <section className="mb-6 rounded-xl border border-ok-line bg-ok-soft/50 p-4">
      <h2 className="mb-2 text-[16px] font-semibold text-ink">Báo giá đã chốt, chưa có dự án · {list.length}</h2>
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
