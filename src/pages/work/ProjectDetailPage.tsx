import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fmtDueDate } from '@/domain';
import { Banner, Button, cx, EmptyState, ErrorBox, Field, Icon, IconName, Loading, Modal, PageHeader, Select, Textarea, useAsync, useToast, PageSkeleton } from '@/components/ui';
import { callApi } from '@/lib/api';
import { useProfile } from '@/lib/session';
import { isMine, isProjectPm, loadMessages, loadProjectQuotes, loadWonQuotes, MemberRow, PersonRow, Task } from './data';
import { TaskHost, useOpenTask, useWork } from './hooks';
import { ChatPicker, MessageHistory, ProgressBar, ProjectForm, ProjectStatusBadge, ProjectSwatch, TaskForm } from './parts';
import { MemberBoard, ProjectTaskList } from './projectViews';

type Tab = 'tasks' | 'members' | 'history';

export function ProjectDetailPage() {
  const { code = '' } = useParams();
  const me = useProfile();
  const toast = useToast();
  const { data, loading, error, reload } = useWork({ projectCode: code });
  const { open } = useOpenTask(data);
  const [tab, setTab] = useState<Tab>('tasks');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [linking, setLinking] = useState(false);
  const [checking, setChecking] = useState(false);
  const project = data?.projects[0] ?? null;
  const history = useAsync(() => (project && tab === 'history' ? loadMessages({ projectId: project.id }) : Promise.resolve([])), [project?.id, tab]);
  if (loading && !data) return <PageSkeleton kind="list" />;
  if (error) return <ErrorBox error={error} />;
  if (!project || !data) return <EmptyState title={`Không thấy dự án ${code}`}>Dự án không tồn tại hoặc bạn không phải thành viên. <Link className="underline" to="/du-an">Về danh sách dự án</Link></EmptyState>;
  const pm = isProjectPm(project, me);
  const activeProject = project.state === 'active';
  const mine = project.tasks.filter((t) => isMine(t, me.id));
  const others = project.tasks.filter((t) => !isMine(t, me.id));
  const staffView = !['pm', 'ceo', 'admin'].includes(me.role);

  async function checkChat() {
    setChecking(true);
    try {
      const r = await callApi<{ linked: boolean }>('work.project_check_chat', { project_id: project!.id });
      if (r.linked) {
        toast('Đã gắn dự án với group Lark');
        reload();
      } else toast(`Không thấy group chứa "${project!.code}". Thêm bot vào group, hoặc chọn group bằng tay.`, 'bad');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <div className="mb-3 text-[13.5px]">
        <Link to="/du-an" className="inline-flex items-center gap-1 text-ink-3 hover:text-ink">
          <Icon name="chevronLeft" size={15} /> Dự án
        </Link>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <ProjectSwatch color={project.color} className="h-3.5 w-3.5" />
            <span className="font-mono text-brand">{project.code}</span>
            {project.name}
          </span>
        }
        subtitle={project.client || undefined}
        actions={
          pm && activeProject ? (
            <>
              <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>
                Sửa dự án
              </Button>
              <Button variant="ghost" icon="trash" onClick={() => setCancelling(true)}>
                Huỷ dự án
              </Button>
            </>
          ) : undefined
        }
      />

      {project.state === 'cancelled' && <Banner tone="warn" title="Dự án đã huỷ" className="mb-4">{project.cancel_reason}</Banner>}
      {pm && activeProject && project.chat_status !== 'linked' && (
        <Banner
          tone="warn"
          title={`Bot chưa có trong group của ${project.code}`}
          className="mb-4"
          actions={
            <>
              <Button size="sm" busy={checking} onClick={checkChat}>
                Kiểm tra lại
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setLinking(true)}>
                Chọn group
              </Button>
            </>
          }
        >
          Thêm bot Go Media vào group Lark của dự án (nên đặt tên group bắt đầu bằng "{project.code}"), rồi bấm Kiểm tra lại. Trong lúc chưa gắn group, tin của dự án được gửi riêng cho PM.
        </Banner>
      )}

      <section aria-label="Tổng quan dự án" className="mb-7 grid overflow-hidden rounded-2xl border border-line bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.rollup.status} />
            <span className="text-[14px] text-ink-2">{project.rollup.reason}</span>
          </div>
          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px]">
            <dt className="flex items-center gap-2 text-ink-3">
              <Icon name="user" size={15} /> PM
            </dt>
            <dd className="text-ink">{project.assignee_name ?? '—'}</dd>
            <dt className="flex items-center gap-2 text-ink-3">
              <Icon name="calendar" size={15} /> Thời gian
            </dt>
            <dd className="text-ink">
              {fmtDueDate(project.start_date)} <span className="text-ink-3">đến</span> {fmtDueDate(project.due_date)}
            </dd>
            <dt className="flex items-center gap-2 text-ink-3">
              <Icon name="message" size={15} /> Group Lark
            </dt>
            <dd className="min-w-0 text-ink">
              {project.chat_status === 'linked' ? <span className="font-medium">{project.chat_name}</span> : <span className="text-ink-3">chưa gắn</span>}
              {project.lark_url && (
                <a className="ml-2 text-brand hover:underline" href={project.lark_url} target="_blank" rel="noreferrer">
                  Mở trên Lark
                </a>
              )}
            </dd>
            <ProjectQuotes projectId={project.id} canLink={pm && activeProject} />
          </dl>
          {project.description && <p className="whitespace-pre-wrap border-t border-line pt-3 text-[14px] text-ink-2">{project.description}</p>}
        </div>
        <div className="flex flex-col justify-center gap-4 border-t border-line bg-canvas/40 p-5 lg:border-l lg:border-t-0">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[13px] text-ink-3">Task đã duyệt</div>
              <div className="text-[30px] font-semibold leading-tight tabular-nums text-ink">
                {project.rollup.done}
                <span className="text-[18px] font-medium text-ink-3">/{project.rollup.total}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] text-ink-3">Thời gian đã đi</div>
              <div className="text-[30px] font-semibold leading-tight tabular-nums text-ink">{project.rollup.timePct}%</div>
            </div>
          </div>
          <ProgressBar r={project.rollup} />
        </div>
      </section>

      <div role="tablist" aria-label="Dự án" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {(
          [
            ['tasks', 'Task', 'tasks', String(project.rollup.total)],
            ['members', 'Thành viên', 'users', `${project.members.filter((m) => m.status === 'accepted').length}${project.members.some((m) => m.status === 'invited') ? ` +${project.members.filter((m) => m.status === 'invited').length} mời` : ''}`],
            ['history', 'Lịch sử nhắc việc', 'bell', ''],
          ] as [Tab, string, IconName, string][]
        ).map(([k, label, icon, count]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx('-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[14.5px] transition-colors', tab === k ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-3 hover:text-ink')}
          >
            <Icon name={icon} size={16} />
            {label}
            {count && <span className={cx('rounded-full px-2 text-[12px] font-semibold leading-5', tab === k ? 'bg-ink text-white' : 'bg-line-soft text-ink-2')}>{count}</span>}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <div className="flex flex-col gap-6">
          {adding && (
            <TaskForm
              project={project}
              members={data.people}
              onCancel={() => setAdding(false)}
              onDone={() => {
                setAdding(false);
                toast('Đã tạo task');
                reload();
              }}
            />
          )}
          {staffView ? (
            <>
              <section>
                <h2 className="mb-3 text-[17px] font-semibold text-ink">Task của bạn</h2>
                <ProjectTaskList tasks={mine} today={data.today} onOpen={(t) => open(t)} showAssignee={false} empty={<p className="text-[14px] text-ink-3">Bạn chưa có task trong dự án này.</p>} />
              </section>
              <section>
                <h2 className="mb-3 text-[17px] font-semibold text-ink">
                  Task của người khác <span className="text-[14px] font-normal text-ink-3">chỉ xem</span>
                </h2>
                <ProjectTaskList tasks={others} today={data.today} onOpen={(t) => open(t)} empty={<p className="text-[14px] text-ink-3">Không có task.</p>} />
              </section>
            </>
          ) : (
            <ProjectTaskList
              tasks={project.tasks}
              today={data.today}
              onOpen={(t) => open(t)}
              actions={
                pm && activeProject && !adding ? (
                  <Button icon="plus" onClick={() => setAdding(true)}>
                    Thêm task
                  </Button>
                ) : undefined
              }
              empty={<EmptyState title="Chưa có task">{pm ? 'Bấm "Thêm task" để giao việc. Mã task tự sinh theo mã dự án.' : 'PM chưa giao task nào.'}</EmptyState>}
            />
          )}
        </div>
      )}

      {tab === 'members' && <Members projectId={project.id} members={project.members} people={data.people} tasks={project.tasks} today={data.today} canEdit={pm && activeProject} live={project.mode === 'live'} onChanged={reload} />}

      {tab === 'history' && (history.loading ? <Loading rows={4} /> : <MessageHistory messages={history.data ?? []} />)}

      <TaskHost data={data} reload={reload} />
      {editing && <ProjectForm project={project} people={data.people} existingCodes={[]} onCancel={() => setEditing(false)} onDone={() => (setEditing(false), toast('Đã lưu dự án'), reload())} />}
      {cancelling && <CancelProject projectId={project.id} onClose={() => setCancelling(false)} onDone={() => (setCancelling(false), reload())} />}
      {linking && (
        <LinkChat
          name={project.name}
          code={project.code}
          projectId={project.id}
          onClose={() => setLinking(false)}
          onDone={() => {
            setLinking(false);
            toast('Đã gắn group');
            reload();
          }}
        />
      )}
    </div>
  );
}

function Members({ projectId, members, people, tasks, today, canEdit, live, onChanged }: { projectId: string; members: MemberRow[]; people: PersonRow[]; tasks: Task[]; today: string; canEdit: boolean; live: boolean; onChanged: () => void }) {
  const toast = useToast();
  const call = (body: Record<string, unknown>, msg: string) =>
    callApi('work.members', { project_id: projectId, ...body }).then(
      () => (toast(msg), onChanged()),
      (e) => toast(e.message, 'bad'),
    );
  return (
    <MemberBoard
      members={members}
      people={people}
      tasks={tasks}
      today={today}
      canEdit={canEdit}
      live={live}
      onInvite={(id) => call({ add_ids: [id] }, 'Đã gửi lời mời')}
      onReinvite={(m) => call({ add_ids: [m.profile_id] }, 'Đã mời lại')}
      onRemove={(m) => call({ remove_ids: [m.profile_id] }, m.status === 'accepted' ? 'Đã bỏ thành viên' : 'Đã huỷ lời mời')}
    />
  );
}

function CancelProject({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Huỷ dự án"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Thôi
          </Button>
          <Button
            variant="danger"
            busy={busy}
            disabled={!reason.trim()}
            onClick={() => {
              setBusy(true);
              callApi('work.project_cancel', { project_id: projectId, reason })
                .then(onDone, (e) => toast(e.message, 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            Huỷ dự án
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[14px] text-ink-2">Mọi task đang mở cũng bị huỷ.</p>
      <Field label="Lý do">{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </Modal>
  );
}

function LinkChat({ code, name, projectId, onClose, onDone }: { code: string; name: string; projectId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [chat, setChat] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Gắn group Lark cho ${code}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Thôi
          </Button>
          <Button
            busy={busy}
            disabled={!chat}
            onClick={() => {
              setBusy(true);
              callApi('work.project_update', { project_id: projectId, chat_id: chat })
                .then(onDone, (e) => toast(e.message, 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            Gắn group
          </Button>
        </>
      }
    >
      <ChatPicker code={code} name={name} projectId={projectId} value={chat} onChange={setChat} />
    </Modal>
  );
}


/** 1.7 · The quotes this project came from (codes only, no money) and, for its PM, attaching another one. */
function ProjectQuotes({ projectId, canLink }: { projectId: string; canLink: boolean }) {
  const me = useProfile();
  const toast = useToast();
  const linked = useAsync(() => loadProjectQuotes(projectId), [projectId]);
  const [picking, setPicking] = useState(false);
  const won = useAsync(() => (picking ? loadWonQuotes(me) : Promise.resolve([])), [picking]);
  const [quoteId, setQuoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; code: string } | null>(null);
  const list = linked.data ?? [];
  if (!list.length && !canLink) return null;
  const mineOnly = me.role === 'account' && list.some((q) => q.created_by === me.id);
  return (
    <>
      <dt className="flex items-center gap-2 text-ink-3">
        <Icon name="file" size={15} /> Báo giá
      </dt>
      <dd className="flex flex-wrap items-center gap-2">
        {list.map((q) => (
          <span key={q.quote_id} className="inline-flex items-center gap-1 rounded-full border border-line-edge bg-paper py-0.5 pl-3 pr-1 text-[13.5px]">
            <Link to={`/quotes/${q.quote_id}`} className="font-semibold text-brand hover:underline">
              {q.code}
            </Link>
            {q.kind === 'project' && <span className="text-[12px] text-ink-3">dự án</span>}
            {canLink ? (
              <button type="button" aria-label={`Gỡ ${q.code} khỏi dự án`} title="Gỡ khỏi dự án" onClick={() => setRemoving({ id: q.quote_id, code: q.code })} className="grid h-6 w-6 place-items-center rounded-full text-ink-3 hover:bg-bad-soft hover:text-bad">
                <Icon name="x" size={14} />
              </button>
            ) : (
              <span className="w-1.5" />
            )}
          </span>
        ))}
        {!list.length && <span className="text-ink-3">chưa gắn</span>}
        {canLink && (
          <Button size="sm" variant="ghost" icon="link" onClick={() => setPicking(true)}>
            Gắn báo giá
          </Button>
        )}
        {mineOnly && <span className="w-full text-[12.5px] text-ink-3">Bạn xem dự án này vì báo giá là của bạn.</span>}
      </dd>
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Gỡ ${removing?.code ?? ''} khỏi dự án?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Thôi
            </Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={() => {
                setBusy(true);
                callApi('work.unlink_quote', { project_id: projectId, quote_id: removing!.id })
                  .then(() => (toast(`Đã gỡ ${removing!.code}`), setRemoving(null), linked.reload()), (e) => toast(e.message, 'bad'))
                  .finally(() => setBusy(false));
              }}
            >
              Gỡ báo giá
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-2">Báo giá quay lại mục "Báo giá đã chốt, chưa có dự án" để gắn vào dự án đúng. Task và thành viên của dự án không đổi.</p>
      </Modal>
      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Gắn báo giá đã chốt"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPicking(false)}>
              Huỷ
            </Button>
            <Button
              busy={busy}
              disabled={!quoteId}
              onClick={() => {
                setBusy(true);
                callApi('work.link_quote', { project_id: projectId, quote_id: quoteId })
                  .then(() => (toast('Đã gắn báo giá'), setPicking(false), setQuoteId(''), linked.reload()), (e) => toast(e.message, 'bad'))
                  .finally(() => setBusy(false));
              }}
            >
              Gắn
            </Button>
          </>
        }
      >
        {won.loading ? (
          <Loading />
        ) : !won.data?.length ? (
          <p className="text-[14px] text-ink-3">Không có báo giá đã chốt nào đang chờ dự án.</p>
        ) : (
          <Field label="Báo giá" hint="Dùng cho phụ lục, bán thêm">
            {(id) => (
              <Select id={id} value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                <option value="">Chọn báo giá…</option>
                {won.data!.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.code}: {q.client || '(chưa có khách)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </Modal>
    </>
  );
}
