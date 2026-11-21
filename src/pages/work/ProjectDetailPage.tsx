import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fmtDueDate } from '@/domain';
import { Badge, Banner, Button, Card, cx, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Select, Textarea, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { useProfile } from '@/lib/session';
import { isMine, isProjectPm, loadMessages } from './data';
import { TaskHost, useOpenTask, useWork } from './hooks';
import { ChatPicker, MessageHistory, ProgressBar, ProjectForm, ProjectStatusBadge, ProjectSwatch, TaskForm, TaskTable } from './parts';

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
  if (loading && !data) return <Loading />;
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
      } else toast(`Chưa thấy group nào tên chứa "${project!.code}" mà bot đang ở. Thêm bot vào group rồi thử lại, hoặc chọn group bằng tay.`, 'bad');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <div className="mb-2 text-[13.5px]">
        <Link to="/du-an" className="text-ink-3 underline hover:text-ink">
          ← Dự án
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
        subtitle={[project.client, `PM ${project.assignee_name ?? '—'}`, `Bắt đầu ${fmtDueDate(project.start_date)}`, `Deadline ${fmtDueDate(project.due_date)}`].filter(Boolean).join(' · ')}
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

      <div className="mb-6 grid gap-6 border-y border-line py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <div className="flex items-center gap-2">
            <ProjectStatusBadge status={project.rollup.status} />
            <span className="text-[14px] text-ink-2">{project.rollup.reason}</span>
          </div>
          <p className="mt-2 text-[13.5px] text-ink-3">
            Group Lark: {project.chat_status === 'linked' ? <b className="text-ink-2">{project.chat_name}</b> : 'chưa gắn'}
            {project.lark_url && (
              <>
                {' · '}
                <a className="underline" href={project.lark_url} target="_blank" rel="noreferrer">
                  Mở trên Lark
                </a>
              </>
            )}
          </p>
          {project.description && <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink-2">{project.description}</p>}
        </div>
        <ProgressBar r={project.rollup} />
      </div>

      <div role="tablist" aria-label="Dự án" className="mb-5 flex gap-6 border-b border-line">
        {(
          [
            ['tasks', `Task (${project.rollup.total})`],
            ['members', `Thành viên (${project.members.length})`],
            ['history', 'Lịch sử nhắc việc'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('-mb-px min-h-[42px] border-b-2 px-0.5 text-[14.5px] transition-colors', tab === k ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'tasks' && (
        <div className="flex flex-col gap-6">
          {pm && activeProject && !adding && (
            <div>
              <Button icon="plus" onClick={() => setAdding(true)}>
                Thêm task
              </Button>
            </div>
          )}
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
              <Card title="Task của bạn">
                <TaskTable tasks={mine} today={data.today} onOpen={(t) => open(t)} showAssignee={false} empty={<p className="text-[14px] text-ink-3">Bạn chưa có task trong dự án này.</p>} />
              </Card>
              <Card title="Task của người khác" subtitle="Chỉ xem: biết mình đang chờ ai và ai đang chờ mình.">
                <TaskTable tasks={others} today={data.today} onOpen={(t) => open(t)} />
              </Card>
            </>
          ) : (
            <TaskTable tasks={project.tasks} today={data.today} onOpen={(t) => open(t)} empty={<EmptyState title="Chưa có task">{pm ? 'Bấm "Thêm task" để giao việc. Mã task tự sinh theo mã dự án.' : 'PM chưa giao task nào.'}</EmptyState>} />
          )}
        </div>
      )}

      {tab === 'members' && <Members projectId={project.id} members={project.members} people={data.people} canEdit={pm && activeProject} live={project.mode === 'live'} onChanged={reload} />}

      {tab === 'history' && (history.loading ? <Loading /> : <MessageHistory messages={history.data ?? []} />)}

      <TaskHost data={data} reload={reload} />
      {editing && <ProjectForm project={project} people={data.people} existingCodes={[]} onCancel={() => setEditing(false)} onDone={() => (setEditing(false), toast('Đã lưu dự án'), reload())} />}
      {cancelling && <CancelProject projectId={project.id} onClose={() => setCancelling(false)} onDone={() => (setCancelling(false), reload())} />}
      {linking && (
        <LinkChat
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

function Members({ projectId, members, people, canEdit, live, onChanged }: { projectId: string; members: { id: string; profile_id: string | null; name: string; source: string }[]; people: { id: string; full_name: string; email: string; role: string; active: boolean }[]; canEdit: boolean; live: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [add, setAdd] = useState('');
  const has = new Set(members.map((m) => m.profile_id));
  const candidates = people.filter((p) => p.active && !has.has(p.id) && !['admin', 'ceo', 'pm'].includes(p.role));
  const SOURCE: Record<string, string> = { group: 'Từ group Lark', task: 'Được giao task', manual: 'PM thêm' };
  const call = (body: Record<string, unknown>) => callApi('work.members', { project_id: projectId, ...body }).then(onChanged, (e) => toast(e.message, 'bad'));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-ink-3">{live ? 'Thành viên lấy từ group Lark của dự án (đồng bộ 15 phút/lần), cộng với người được giao task.' : 'Chế độ mô phỏng: PM thêm thành viên bằng tay. Khi chạy Lark thật, thành viên lấy từ group của dự án.'}</p>
      <ul className="divide-y divide-line-soft border-y border-line">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
            <div>
              <div className="font-medium text-ink">{m.name || '—'}</div>
              <div className="text-[12.5px] text-ink-3">
                {SOURCE[m.source]}
                {!m.profile_id && <Badge tone="warn" className="ml-2">Chưa có tài khoản Ops Hub</Badge>}
              </div>
            </div>
            {canEdit && m.profile_id && m.source !== 'group' && (
              <Button size="sm" variant="ghost" onClick={() => call({ remove_ids: [m.profile_id] })}>
                Bỏ
              </Button>
            )}
          </li>
        ))}
        {!members.length && <li className="py-3 text-ink-3">Chưa có thành viên.</li>}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Thêm thành viên" className="min-w-[240px]">
            {(id) => (
              <Select id={id} value={add} onChange={(e) => setAdd(e.target.value)}>
                <option value="">Chọn người…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="secondary" disabled={!add} onClick={() => call({ add_ids: [add] }).then(() => setAdd(''))}>
            Thêm
          </Button>
        </div>
      )}
    </div>
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
      <p className="mb-3 text-[14px] text-ink-2">Các task đang mở của dự án cũng được huỷ. Bot báo vào group dự án.</p>
      <Field label="Lý do">{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </Modal>
  );
}

function LinkChat({ code, projectId, onClose, onDone }: { code: string; projectId: string; onClose: () => void; onDone: () => void }) {
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
      <ChatPicker code={code} value={chat} onChange={setChat} />
    </Modal>
  );
}

