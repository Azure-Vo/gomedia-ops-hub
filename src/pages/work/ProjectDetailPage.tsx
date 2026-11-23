import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fmtDueDate, MEMBER_STATUS_LABEL } from '@/domain';
import { Badge, Banner, Button, Card, cx, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Select, Textarea, useAsync, useToast, PageSkeleton } from '@/components/ui';
import { callApi } from '@/lib/api';
import { useProfile } from '@/lib/session';
import { isMine, isProjectPm, loadMessages, loadProjectQuotes, loadWonQuotes, MemberRow, PersonRow } from './data';
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
        subtitle={[project.client, `PM ${project.assignee_name ?? '—'}`, `Bắt đầu ${fmtDueDate(project.start_date)}`, `Deadline ${fmtDueDate(project.due_date)}`].filter(Boolean).join(', ')}
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
                {', '}
                <a className="underline" href={project.lark_url} target="_blank" rel="noreferrer">
                  Mở trên Lark
                </a>
              </>
            )}
          </p>
          {project.description && <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink-2">{project.description}</p>}
          <ProjectQuotes projectId={project.id} canLink={pm && activeProject} />
        </div>
        <ProgressBar r={project.rollup} />
      </div>

      <div role="tablist" aria-label="Dự án" className="mb-5 flex gap-6 border-b border-line">
        {(
          [
            ['tasks', `Task (${project.rollup.total})`],
            ['members', `Thành viên (${project.members.filter((m) => m.status === 'accepted').length}${project.members.some((m) => m.status === 'invited') ? `, ${project.members.filter((m) => m.status === 'invited').length} đang mời` : ''})`],
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
              <Card title="Task của người khác" subtitle="Chỉ xem">
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

function Members({ projectId, members, people, canEdit, live, onChanged }: { projectId: string; members: MemberRow[]; people: PersonRow[]; canEdit: boolean; live: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [add, setAdd] = useState('');
  const has = new Set(members.filter((m) => m.status !== 'declined').map((m) => m.profile_id));
  const candidates = people.filter((p) => p.active && !has.has(p.id) && !['admin', 'ceo', 'pm'].includes(p.role));
  const SOURCE: Record<string, string> = { group: 'Từ group Lark', task: 'Được giao task', manual: 'PM mời' };
  const TONE = { accepted: 'ok', invited: 'brand', declined: 'bad' } as const;
  const call = (body: Record<string, unknown>, msg: string) =>
    callApi('work.members', { project_id: projectId, ...body }).then(
      () => (toast(msg), onChanged()),
      (e) => toast(e.message, 'bad'),
    );
  const order = { invited: 0, declined: 1, accepted: 2 } as const;
  const rows = [...members].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const fmtAt = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : '');
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-ink-3">
        Chỉ giao task cho người đã Tham gia.
        {live ? ' Người trong group Lark của dự án tự là thành viên.' : ''}
      </p>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Mời thành viên" className="min-w-[240px]">
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
          <Button icon="send" disabled={!add} onClick={() => call({ add_ids: [add] }, 'Đã gửi lời mời').then(() => setAdd(''))}>
            Gửi lời mời
          </Button>
        </div>
      )}
      <ul className="divide-y divide-line-soft border-y border-line">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-medium text-ink">
                {m.name || '—'}
                <Badge tone={TONE[m.status]}>{MEMBER_STATUS_LABEL[m.status]}</Badge>
                {!m.profile_id && <Badge tone="warn">Chưa có tài khoản Ops Hub</Badge>}
              </div>
              <div className="text-[12.5px] text-ink-3">
                {SOURCE[m.source]}
                {m.status === 'invited' && m.invited_at && `, mời ngày ${fmtAt(m.invited_at)}`}
                {m.status !== 'invited' && m.responded_at && m.source === 'manual' && `, trả lời ngày ${fmtAt(m.responded_at)}`}
              </div>
              {m.status === 'declined' && <div className="mt-1 text-[13.5px] text-bad">Lý do: {m.decline_reason || 'không ghi'}</div>}
            </div>
            {canEdit && m.profile_id && m.source !== 'group' && (
              <div className="flex gap-2">
                {m.status === 'declined' && (
                  <Button size="sm" variant="secondary" onClick={() => call({ add_ids: [m.profile_id] }, 'Đã mời lại')}>
                    Mời lại
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => call({ remove_ids: [m.profile_id] }, m.status === 'accepted' ? 'Đã bỏ thành viên' : 'Đã huỷ lời mời')}>
                  {m.status === 'accepted' ? 'Bỏ' : m.status === 'invited' ? 'Huỷ lời mời' : 'Xoá'}
                </Button>
              </div>
            )}
          </li>
        ))}
        {!rows.length && <li className="py-3 text-ink-3">Chưa có thành viên.</li>}
      </ul>
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
  const list = linked.data ?? [];
  if (!list.length && !canLink) return null;
  const mineOnly = me.role === 'account' && list.some((q) => q.created_by === me.id);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]">
      <span className="text-ink-3">Báo giá:</span>
      {list.length ? (
        list.map((q) => (
          <Link key={q.quote_id} to={`/quotes/${q.quote_id}`} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
            {q.code}
            {q.kind === 'project' && <Badge tone="accent">Dự án</Badge>}
          </Link>
        ))
      ) : (
        <span className="text-ink-3">chưa gắn</span>
      )}
      {canLink && (
        <Button size="sm" variant="ghost" icon="link" onClick={() => setPicking(true)}>
          Gắn báo giá
        </Button>
      )}
      {mineOnly && <span className="text-[12.5px] text-ink-3">Bạn xem dự án này vì báo giá là của bạn.</span>}
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
    </div>
  );
}
