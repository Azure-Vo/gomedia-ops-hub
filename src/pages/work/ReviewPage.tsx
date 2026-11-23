import { fmtDueDate, localDateKey, workDaysAfter } from '@/domain';
import { Badge, Banner, Button, EmptyState, ErrorBox, PageHeader, PageSkeleton } from '@/components/ui';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { isProjectPm } from './data';
import { TaskHost, useOpenTask, useWork } from './hooks';
import { Evidence, ProjectSwatch } from './parts';

/** PRD 4.2 · Chờ duyệt: kết quả cần nộp đặt cạnh bằng chứng, task chờ lâu nhất xếp đầu. */
export function ReviewPage() {
  const me = useProfile();
  const { calendar, tz } = useSettings();
  const { data, loading, error, reload } = useWork();
  const { open } = useOpenTask(data);
  if (loading && !data) return <PageSkeleton kind="list" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const waiting = data.tasks
    .filter((t) => t.state === 'review' && (me.role !== 'pm' || isProjectPm(t.project, me)))
    .map((t) => ({ t, days: t.review_since ? workDaysAfter(localDateKey(Date.parse(t.review_since), tz), data.today, calendar) : 0 }))
    .sort((a, b) => b.days - a.days || a.t.due_date.localeCompare(b.t.due_date));
  const canReview = me.role === 'pm';
  return (
    <div>
      <PageHeader title="Chờ duyệt" subtitle="So bằng chứng với kết quả cần nộp, rồi Duyệt hoặc Yêu cầu sửa." />
      {me.role === 'ceo' && <Banner className="mb-4">CEO chỉ xem. PM của dự án duyệt.</Banner>}
      {!waiting.length ? (
        <EmptyState title="Không có task nào chờ duyệt" />
      ) : (
        <ul className="flex flex-col gap-4">
          {waiting.map(({ t, days }) => (
            <li key={t.id} className="rounded-xl border border-line bg-white p-4 shadow-sheet">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[14px] text-brand">{t.code}</span>
                    <b className="text-[16px] text-ink">{t.name}</b>
                    {days > 1 ? <Badge tone="warn">Chờ {days} ngày làm việc</Badge> : <Badge tone="brand">{days === 1 ? 'Chờ 1 ngày làm việc' : 'Nộp hôm nay'}</Badge>}
                    {!t.hasEvidence && <Badge tone="warn">Chưa có bằng chứng</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13px] text-ink-3">
                    <span className="inline-flex items-center gap-1.5">
                      <ProjectSwatch color={t.project.color} /> {t.project.code}
                    </span>
                    <span>{t.assignee_name}</span>
                    <span>Deadline {fmtDueDate(t.due_date)}</span>
                    {t.kpi === 'overdue' && <span className="font-semibold text-bad">nộp sau deadline</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => open(t)}>
                    Chi tiết
                  </Button>
                  {canReview && (
                    <Button icon="check" onClick={() => open(t, 'review')}>
                      Duyệt / Yêu cầu sửa
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-[12.5px] font-semibold uppercase tracking-[0.04em] text-ink-3">Kết quả cần nộp</div>
                  <p className="whitespace-pre-wrap text-[14.5px] text-ink">{t.expected_output || '—'}</p>
                </div>
                <div>
                  <div className="mb-1 text-[12.5px] font-semibold uppercase tracking-[0.04em] text-ink-3">Bằng chứng đã nộp</div>
                  {t.pending ? <Evidence sub={t.pending} taskId={t.id} /> : <p className="text-ink-3">—</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <TaskHost data={data} reload={reload} />
    </div>
  );
}
