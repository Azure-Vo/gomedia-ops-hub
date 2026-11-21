import { Link } from 'react-router-dom';
import { daysBetween, weekOf } from '@/domain';
import { Badge, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { useProfile } from '@/lib/session';
import { isProjectPm, Task } from './data';
import { useWork } from './hooks';

/** PRD 4.2 · Nhân sự: ai đang giữ bao nhiêu việc, để phân việc không dồn vào một người. */
export function PeoplePage() {
  const me = useProfile();
  const { data, loading, error } = useWork();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const scope = data.tasks.filter((t) => me.role !== 'pm' || isProjectPm(t.project, me));
  const week = weekOf(data.today);
  const people = new Map<string, { name: string; tasks: Task[] }>();
  for (const t of scope) {
    const key = t.assignee_id ?? t.assignee_open_id ?? '—';
    const cur = people.get(key) ?? { name: t.assignee_name ?? '—', tasks: [] };
    cur.tasks.push(t);
    people.set(key, cur);
  }
  const rows = [...people.entries()]
    .map(([id, p]) => {
      const open = p.tasks.filter((t) => t.state === 'doing' || t.state === 'changes');
      return {
        id,
        name: p.name,
        open: open.length,
        overdue: open.filter((t) => t.due_date < data.today).length,
        thisWeek: open.filter((t) => t.due_date >= week[0] && t.due_date <= week[6]).length,
        review: p.tasks.filter((t) => t.state === 'review').length,
        blocked: open.filter((t) => t.progress === 'blocked').length,
        changes: p.tasks.filter((t) => t.state === 'changes').length,
        next: open.map((t) => daysBetween(data.today, t.due_date)).sort((a, b) => a - b)[0],
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
  return (
    <div>
      <PageHeader title="Nhân sự" subtitle="Số task đang mở của từng người trong các dự án bạn phụ trách. Xem trước khi giao thêm việc." />
      {!rows.length ? (
        <EmptyState title="Chưa có ai được giao task" />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] text-[14.5px]">
            <thead>
              <tr className="border-b border-ink text-left text-[12.5px] text-ink-3">
                <th className="py-2 pr-3 font-medium">Người</th>
                <th className="py-2 pr-3 text-right font-medium">Đang mở</th>
                <th className="py-2 pr-3 text-right font-medium">Đến hạn tuần này</th>
                <th className="py-2 pr-3 text-right font-medium">Quá hạn</th>
                <th className="py-2 pr-3 text-right font-medium">Bị chặn</th>
                <th className="py-2 pr-3 text-right font-medium">Cần sửa</th>
                <th className="py-2 pr-3 text-right font-medium">Chờ duyệt</th>
                <th className="py-2 pr-3 font-medium">Deadline gần nhất</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line-soft">
                  <td className="py-2.5 pr-3 font-medium text-ink">
                    <Link className="hover:text-brand hover:underline" to={`/lich?view=people`}>
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-3 text-right">{r.open >= 5 ? <Badge tone="warn">{r.open}</Badge> : r.open}</td>
                  <td className="py-2.5 pr-3 text-right">{r.thisWeek}</td>
                  <td className="py-2.5 pr-3 text-right">{r.overdue ? <Badge tone="bad">{r.overdue}</Badge> : 0}</td>
                  <td className="py-2.5 pr-3 text-right">{r.blocked ? <Badge tone="bad">{r.blocked}</Badge> : 0}</td>
                  <td className="py-2.5 pr-3 text-right">{r.changes}</td>
                  <td className="py-2.5 pr-3 text-right">{r.review}</td>
                  <td className="py-2.5 pr-3 text-ink-2">{r.next === undefined ? '—' : r.next < 0 ? `quá ${-r.next} ngày` : r.next === 0 ? 'hôm nay' : `còn ${r.next} ngày`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
