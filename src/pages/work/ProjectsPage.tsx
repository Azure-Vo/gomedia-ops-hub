import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fmtDueDate, PROJECT_STATUS_RANK } from '@/domain';
import { Button, cx, EmptyState, ErrorBox, Icon, Loading, PageHeader } from '@/components/ui';
import { useProfile } from '@/lib/session';
import { isMine, isProjectPm, Project } from './data';
import { useWork } from './hooks';
import { ProgressBar, ProjectForm, ProjectStatusBadge, ProjectSwatch } from './parts';

type Filter = 'mine' | 'attention' | 'open' | 'done';

/** PM: every project with its progress (PRD 4.2). Staff: "Dự án của tôi" (PRD 4.1). */
export function ProjectsPage() {
  const me = useProfile();
  const nav = useNavigate();
  const { data, loading, error, reload } = useWork();
  const pm = me.role === 'pm';
  const [filter, setFilter] = useState<Filter>(pm ? 'mine' : 'open');
  const [creating, setCreating] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const staffView = !['pm', 'ceo', 'admin'].includes(me.role);
  const rows = data.projects
    .filter((p) => {
      if (filter === 'mine') return pm ? p.pm_id === me.id || !p.pm_id : true;
      if (filter === 'attention') return ['late', 'red', 'risk'].includes(p.rollup.status);
      if (filter === 'done') return p.rollup.status === 'done' || p.rollup.status === 'cancelled';
      return p.rollup.status !== 'done' && p.rollup.status !== 'cancelled';
    })
    .sort((a, b) => PROJECT_STATUS_RANK[a.rollup.status] - PROJECT_STATUS_RANK[b.rollup.status] || a.due_date.localeCompare(b.due_date));
  const filters: [Filter, string][] = pm
    ? [
        ['mine', 'Của tôi'],
        ['attention', 'Trễ / có nguy cơ'],
        ['open', 'Đang chạy'],
        ['done', 'Đã xong'],
      ]
    : [
        ['open', 'Đang chạy'],
        ['attention', 'Trễ / có nguy cơ'],
        ['done', 'Đã xong'],
      ];
  return (
    <div>
      <PageHeader
        title={staffView ? 'Dự án của tôi' : 'Dự án'}
        subtitle={staffView ? 'Các dự án bạn là thành viên. Bạn xem được mọi task trong dự án, chỉ thao tác được task của mình.' : 'Dự án trễ và có nguy cơ xếp trước. Bấm vào dự án để xem task, thành viên và lịch sử nhắc việc.'}
        actions={
          pm && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Dự án mới
            </Button>
          )
        }
      />
      <div role="tablist" aria-label="Lọc dự án" className="mb-5 flex flex-wrap gap-2">
        {filters.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={filter === k} type="button" onClick={() => setFilter(k)} className={cx('min-h-[36px] rounded-full border px-3.5 text-[14px] font-medium', filter === k ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-2 hover:border-ink-3')}>
            {label}
          </button>
        ))}
      </div>
      {!rows.length ? (
        <EmptyState title={data.projects.length ? 'Không có dự án nào trong mục này' : staffView ? 'Bạn chưa là thành viên dự án nào' : 'Chưa có dự án'} action={pm && !data.projects.length ? <Button icon="plus" onClick={() => setCreating(true)}>Tạo dự án đầu tiên</Button> : undefined}>
          {staffView ? 'Khi PM thêm bạn vào group Lark của dự án hoặc giao task cho bạn, dự án sẽ hiện ở đây.' : 'Dự án gắn với group Lark của nó; task trong dự án có mã tự sinh như MT35-01.'}
        </EmptyState>
      ) : (
        <ul className="flex flex-col">
          {rows.map((p) => (
            <ProjectRowItem key={p.id} p={p} meId={me.id} showMine={staffView} isPm={isProjectPm(p, me)} />
          ))}
        </ul>
      )}
      {creating && (
        <ProjectForm
          people={data.people}
          existingCodes={data.projects.map((p) => p.code)}
          onCancel={() => setCreating(false)}
          onDone={(code) => {
            setCreating(false);
            reload();
            nav(`/du-an/${encodeURIComponent(code)}`);
          }}
        />
      )}
    </div>
  );
}

function ProjectRowItem({ p, meId, showMine, isPm }: { p: Project; meId: string; showMine: boolean; isPm: boolean }) {
  const mineOpen = p.tasks.filter((t) => isMine(t, meId) && (t.state === 'doing' || t.state === 'changes')).length;
  return (
    <li className="border-t border-line first:border-ink">
      <Link to={`/du-an/${encodeURIComponent(p.code)}`} className="grid gap-x-6 gap-y-2 py-4 transition-colors hover:bg-white sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:px-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectSwatch color={p.color} />
            <span className="font-mono text-[14px] font-semibold text-brand">{p.code}</span>
            <span className="text-[16px] font-semibold text-ink">{p.name}</span>
            <ProjectStatusBadge status={p.rollup.status} />
            {isPm && p.chat_status === 'missing' && p.state === 'active' && (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-warn">
                <Icon name="alert" size={14} /> Chưa gắn group Lark
              </span>
            )}
          </div>
          <div className="mt-1 text-[13.5px] text-ink-3">
            {[p.client, `PM ${p.assignee_name ?? '—'}`, `Deadline ${fmtDueDate(p.due_date)}`, p.chat_status === 'linked' && p.chat_name ? `Group: ${p.chat_name}` : null].filter(Boolean).join(' · ')}
            {showMine && mineOpen > 0 && <span className="ml-2 font-semibold text-ink-2">· {mineOpen} task của bạn đang mở</span>}
          </div>
          {['late', 'red', 'risk'].includes(p.rollup.status) && <div className="mt-1 text-[13px] text-ink-2">{p.rollup.reason}</div>}
        </div>
        <ProgressBar r={p.rollup} />
      </Link>
    </li>
  );
}
