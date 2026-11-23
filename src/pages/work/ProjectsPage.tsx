import { ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fmtDueDate, PROJECT_STATUS_RANK } from '@/domain';
import { Badge, Button, cx, EmptyState, ErrorBox, Icon, PageHeader, PageSkeleton } from '@/components/ui';
import { useProfile } from '@/lib/session';
import { isMine, isProjectPm, Project } from './data';
import { useWork } from './hooks';
import { ProgressBar, ProjectForm, ProjectStatusBadge, ProjectSwatch } from './parts';

type Status = 'open' | 'attention' | 'done' | 'all';
type Scope = 'mine' | 'others' | 'all';

const STATUS_TEST: Record<Status, (p: Project) => boolean> = {
  open: (p) => p.rollup.status !== 'done' && p.rollup.status !== 'cancelled',
  attention: (p) => ['late', 'red', 'risk'].includes(p.rollup.status),
  done: (p) => p.rollup.status === 'done' || p.rollup.status === 'cancelled',
  all: () => true,
};

/** PM: own projects and other PMs' projects, kept apart (PRD 4.2). Staff: "Dự án của tôi" (PRD 4.1). */
export function ProjectsPage() {
  const me = useProfile();
  const nav = useNavigate();
  const { data, loading, error, reload } = useWork();
  const [params, setParams] = useSearchParams();
  const pm = me.role === 'pm';
  const staffView = !['pm', 'ceo', 'admin'].includes(me.role);
  const status = (params.get('trang-thai') as Status) || 'open';
  const scope: Scope = pm ? ((params.get('pham-vi') as Scope) || 'mine') : 'all';
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    n.set(k, v);
    setParams(n, { replace: true });
  };
  const fromQuote = params.get('tu-bao-gia') ?? undefined;
  const [creating, setCreating] = useState(!!fromQuote && pm);
  if (loading && !data) return <PageSkeleton kind="list" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const pmName = (p: Project) => {
    const person = p.pm_id ? data.people.find((x) => x.id === p.pm_id) : null;
    return person?.full_name || person?.email || p.assignee_name || 'Chưa có PM';
  };
  const ownedByMe = (p: Project) => isProjectPm(p, me);
  const byStatus = data.projects
    .filter(STATUS_TEST[status])
    .sort((a, b) => PROJECT_STATUS_RANK[a.rollup.status] - PROJECT_STATUS_RANK[b.rollup.status] || a.due_date.localeCompare(b.due_date));
  const mine = pm ? byStatus.filter(ownedByMe) : [];
  const others = pm ? byStatus.filter((p) => !ownedByMe(p)) : byStatus;

  const statuses: [Status, string][] = [
    ['open', 'Đang chạy'],
    ['attention', 'Trễ / có nguy cơ'],
    ['done', 'Đã xong'],
    ['all', 'Mọi trạng thái'],
  ];
  const scopes: [Scope, string, number][] = [
    ['mine', 'Của tôi', mine.length],
    ['others', 'PM khác', others.length],
    ['all', 'Tất cả', byStatus.length],
  ];

  /** Other PMs' projects, one block per PM. */
  const groupedByPm = (list: Project[]) => {
    const groups = new Map<string, Project[]>();
    for (const p of list) groups.set(pmName(p), [...(groups.get(pmName(p)) ?? []), p]);
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi'));
  };
  const list = (rows: Project[], readOnly: boolean) => (
    <ul className="flex flex-col rounded-2xl border border-line bg-paper px-2">
      {rows.map((p) => (
        <ProjectRowItem key={p.id} p={p} meId={me.id} showMine={staffView} isPm={ownedByMe(p)} readOnly={readOnly} pmLabel={pmName(p)} />
      ))}
    </ul>
  );
  const empty = (
    <EmptyState title={data.projects.length ? 'Không có dự án nào trong mục này' : staffView ? 'Bạn chưa là thành viên dự án nào' : 'Chưa có dự án'} action={pm && !data.projects.length ? <Button icon="plus" onClick={() => setCreating(true)}>Tạo dự án đầu tiên</Button> : undefined}>
      {staffView ? 'Dự án hiện ở đây khi bạn Tham gia lời mời.' : 'Tạo dự án để bắt đầu giao task.'}
    </EmptyState>
  );

  let body: ReactNode;
  if (staffView) body = byStatus.length ? list(byStatus, false) : empty;
  else if (scope === 'mine') body = mine.length ? list(mine, false) : empty;
  else {
    const showMine = scope === 'all' && pm;
    const otherGroups = groupedByPm(others);
    body =
      !(showMine ? mine.length : 0) && !others.length ? (
        empty
      ) : (
        <div className="flex flex-col gap-8">
          {showMine && (
            <Section title="Dự án của tôi" count={mine.length} >
              {mine.length ? list(mine, false) : <p className="py-3 text-[14px] text-ink-3">Không có dự án nào của bạn trong mục này.</p>}
            </Section>
          )}
          <Section title={pm ? 'Dự án của PM khác' : 'Tất cả dự án'} count={others.length} note={pm ? 'Chỉ xem' : undefined} tone={pm ? 'muted' : undefined}>
            {otherGroups.length ? (
              <div className="flex flex-col gap-5">
                {otherGroups.map(([name, rows]) => (
                  <div key={name}>
                    <h3 className="mb-1 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-3">
                      <Icon name="users" size={14} /> PM {name} ({rows.length})
                    </h3>
                    {list(rows, pm)}
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-3 text-[14px] text-ink-3">Không có dự án nào của PM khác trong mục này.</p>
            )}
          </Section>
        </div>
      );
  }

  return (
    <div>
      <PageHeader
        title={staffView ? 'Dự án của tôi' : 'Dự án'}
        subtitle={staffView ? 'Dự án bạn tham gia.' : 'Dự án trễ, có nguy cơ xếp trước.'}
        actions={
          pm && (
            <Button icon="plus" onClick={() => setCreating(true)}>
              Dự án mới
            </Button>
          )
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        {pm && (
          <div role="tablist" aria-label="Dự án của ai" className="flex rounded-lg bg-ink/[0.06] p-1">
            {scopes.map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={scope === k} onClick={() => setParam('pham-vi', k)} className={cx('min-h-[34px] rounded-md px-3.5 text-[14px] font-medium', scope === k ? 'bg-white text-ink shadow-sheet' : 'text-ink-2 hover:text-ink')}>
                {label} <span className={cx('ml-0.5 text-[12.5px]', scope === k ? 'text-ink-3' : 'text-ink-3/80')}>{n}</span>
              </button>
            ))}
          </div>
        )}
        <div role="tablist" aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2">
          {statuses.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={status === k} type="button" onClick={() => setParam('trang-thai', k)} className={cx('min-h-[34px] rounded-full border px-3.5 text-[14px] font-medium', status === k ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-2 hover:border-ink-3')}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {body}
      {creating && (
        <ProjectForm
          fromQuoteId={fromQuote}
          people={data.people}
          existingCodes={data.projects.map((p) => p.code)}
          onCancel={() => {
            setCreating(false);
            if (fromQuote) setParam('tu-bao-gia', '');
          }}
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

function Section({ title, count, note, tone, children }: { title: string; count: number; note?: string; tone?: 'muted'; children: ReactNode }) {
  return (
    <section>
      <div className={cx('mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 pb-2', tone === 'muted' ? 'border-line' : 'border-ink')}>
        <h2 className="text-[19px] font-semibold text-ink">
          {title} <span className="text-[15px] font-normal text-ink-3">{count}</span>
        </h2>
        {note && <span className="text-[13.5px] text-ink-3">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function ProjectRowItem({ p, meId, showMine, isPm, readOnly, pmLabel }: { p: Project; meId: string; showMine: boolean; isPm: boolean; readOnly?: boolean; pmLabel: string }) {
  const mineOpen = p.tasks.filter((t) => isMine(t, meId) && (t.state === 'doing' || t.state === 'changes')).length;
  return (
    <li className="border-t border-line first:border-t-0">
      <Link to={`/du-an/${encodeURIComponent(p.code)}`} className="grid gap-x-6 gap-y-2 py-4 transition-colors hover:bg-white sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:px-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectSwatch color={p.color} />
            <span className="font-mono text-[14px] font-semibold text-brand">{p.code}</span>
            <span className="text-[16px] font-semibold text-ink">{p.name}</span>
            <ProjectStatusBadge status={p.rollup.status} />
            {readOnly && <Badge>Chỉ xem</Badge>}
            {isPm && p.chat_status === 'missing' && p.state === 'active' && (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-warn">
                <Icon name="alert" size={14} /> Chưa gắn group Lark
              </span>
            )}
          </div>
          <div className="mt-1 text-[13.5px] text-ink-3">
            {[p.client, `PM ${pmLabel}`, `Deadline ${fmtDueDate(p.due_date)}`, p.chat_status === 'linked' && p.chat_name ? `Group: ${p.chat_name}` : null].filter(Boolean).join(', ')}
            {showMine && mineOpen > 0 && <span className="ml-2 font-semibold text-ink-2">({mineOpen} task của bạn đang mở)</span>}
          </div>
          {['late', 'red', 'risk'].includes(p.rollup.status) && <div className="mt-1 text-[13px] text-ink-2">{p.rollup.reason}</div>}
        </div>
        <ProgressBar r={p.rollup} />
      </Link>
    </li>
  );
}
