import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  autoTier,
  checkProjectCode,
  daysBetween,
  EXTEND_REASON_HINT,
  EXTEND_REASON_LABEL,
  ExtendReason,
  extensionErrors,
  fmtDueDate,
  Health,
  HEALTH_LABEL,
  MAX_EVIDENCE_BYTES,
  normalizeProjectCode,
  PROGRESS_LABEL,
  PROJECT_COLORS,
  PROJECT_STATUS_LABEL,
  ProjectStatus,
  ReminderTier,
  Rollup,
  TASK_STAGE_LABEL,
  TaskStage,
  taskCode,
  taskDateErrors,
  TIER_LABEL,
  tierHint,
  whyNot,
  chatCodeConflict,
  chatMatchesCode,
  chatNameFor,
  PROJECT_CODE_RE,
} from '@/domain';
import { Badge, Banner, Button, cx, EmptyState, Field, Icon, Input, Loading, Modal, Select, Textarea, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { BotCard } from '@/pages/lark/BotCard';
import { BotMessageRow, isMine, isProjectPm, loadTaskHistory, loadWonQuotes, PersonRow, Project, ProjectRow, SubmissionRow, Task, WonQuote } from './data';

// ------------------------------------------------------------------------------ small marks --------

const DOT: Record<Health, string> = {
  red: 'bg-bad',
  amber: 'bg-[#D08A1A]',
  green: 'bg-ok',
  blue: 'bg-brand',
  done: 'bg-ok-line',
  cancelled: 'bg-line',
};

export function HealthDot({ health, reason, className }: { health: Health; reason?: string; className?: string }) {
  const label = `${HEALTH_LABEL[health]}${reason ? `: ${reason}` : ''}`;
  return (
    <span title={label} className={cx('inline-flex shrink-0 items-center', className)}>
      <span aria-hidden className={cx('inline-block h-2.5 w-2.5 rounded-full', DOT[health], health === 'done' && 'ring-1 ring-ok')} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

const STAGE_TONE: Record<TaskStage, 'neutral' | 'brand' | 'warn' | 'ok'> = { doing: 'neutral', review: 'brand', changes: 'warn', done: 'ok', cancelled: 'neutral' };
export function StageBadge({ state }: { state: TaskStage }) {
  return <Badge tone={STAGE_TONE[state]}>{TASK_STAGE_LABEL[state]}</Badge>;
}

const STATUS_TONE: Record<ProjectStatus, 'bad' | 'warn' | 'ok' | 'neutral' | 'brand'> = { late: 'bad', red: 'bad', risk: 'warn', ok: 'ok', done: 'brand', cancelled: 'neutral' };
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{PROJECT_STATUS_LABEL[status]}</Badge>;
}

export function ProjectSwatch({ color, className }: { color: string | null; className?: string }) {
  return <span aria-hidden className={cx('inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]', className)} style={{ background: color ?? PROJECT_COLORS[0] }} />;
}

/** PRD 5.5: one bar split by colour, approved share as the percentage. */
export function ProgressBar({ r, className, compact }: { r: Rollup; className?: string; compact?: boolean }) {
  const total = Math.max(1, r.total);
  const parts: [number, string, string][] = [
    [r.done, 'bg-ok', 'xong'],
    [r.review, 'bg-brand', 'chờ duyệt'],
    [r.green, 'bg-ok-line', 'ổn'],
    [r.amber, 'bg-[#E7B35A]', 'nguy cơ'],
    [r.red, 'bg-bad', 'cần can thiệp'],
  ];
  return (
    <div className={className}>
      <div className="flex items-center gap-3">
        <div className="flex h-2.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-line-soft" role="img" aria-label={`${r.done}/${r.total} task đã duyệt`}>
          {parts.map(([n, cls, label]) => (n ? <span key={label} className={cls} style={{ width: `${(n / total) * 100}%` }} title={`${n} ${label}`} /> : null))}
        </div>
        <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink">
          {r.done}/{r.total} · {r.pct}%
        </span>
      </div>
      {!compact && (
        <div className="mt-1 text-[12.5px] text-ink-3">
          {r.total ? parts.filter(([n]) => n).map(([n, , label]) => `${n} ${label}`).join(' · ') : 'Chưa có task'}
          {r.total > 0 && ` · đã đi ${r.timePct}% thời gian`}
        </div>
      )}
    </div>
  );
}

export function DueText({ task, today }: { task: Pick<Task, 'due_date' | 'state'>; today: string }) {
  const left = daysBetween(today, task.due_date);
  const open = task.state === 'doing' || task.state === 'changes';
  return (
    <span className="whitespace-nowrap tabular-nums">
      {fmtDueDate(task.due_date)}
      {open && <span className={cx('ml-1.5 text-[12.5px]', left < 0 ? 'font-semibold text-bad' : left <= 1 ? 'text-warn' : 'text-ink-3')}>{left < 0 ? `quá ${-left} ngày` : left === 0 ? 'hôm nay' : `còn ${left} ngày`}</span>}
    </span>
  );
}

// ------------------------------------------------------------------------------- task table --------

export function TaskTable({ tasks, today, onOpen, showProject, showAssignee = true, empty }: { tasks: Task[]; today: string; onOpen: (t: Task) => void; showProject?: boolean; showAssignee?: boolean; empty?: ReactNode }) {
  if (!tasks.length) return <>{empty ?? <p className="text-[14px] text-ink-3">Không có task.</p>}</>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[640px] text-[14.5px]">
        <thead>
          <tr className="border-b border-ink text-left text-[12.5px] text-ink-3">
            <th className="w-6 py-2" />
            <th className="py-2 pr-3 font-medium">Task</th>
            {showProject && <th className="py-2 pr-3 font-medium">Dự án</th>}
            {showAssignee && <th className="py-2 pr-3 font-medium">Người thực hiện</th>}
            <th className="py-2 pr-3 font-medium">Deadline</th>
            <th className="py-2 pr-3 font-medium">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="cursor-pointer border-b border-line-soft align-top transition-colors hover:bg-white" onClick={() => onOpen(t)}>
              <td className="py-3">
                <HealthDot health={t.health} reason={t.reason} />
              </td>
              <td className="py-2.5 pr-3">
                <button type="button" className="text-left font-medium text-ink hover:text-brand focus:outline-none focus-visible:underline" onClick={(e) => (e.stopPropagation(), onOpen(t))}>
                  <span className="mr-2 font-mono text-[13px] text-brand">{t.code}</span>
                  {t.name}
                </button>
                {(t.health === 'red' || t.health === 'amber') && <div className="mt-0.5 text-[12.5px] text-ink-3">{t.reason}</div>}
              </td>
              {showProject && (
                <td className="py-2.5 pr-3 text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <ProjectSwatch color={t.project.color} />
                    {t.project.code}
                  </span>
                </td>
              )}
              {showAssignee && <td className="py-2.5 pr-3 text-ink-2">{t.assignee_name ?? '—'}</td>}
              <td className="py-2.5 pr-3">
                <DueText task={t} today={today} />
              </td>
              <td className="py-2.5 pr-3">
                <StageBadge state={t.state} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------------------ task drawer --------

export type Panel = null | 'submit' | 'progress' | 'review' | 'extend' | 'cancel' | 'reopen' | 'edit';

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-t border-line pt-3', className)}>
      <h3 className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-[0.04em] text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

async function openFile(taskId: string, path: string) {
  const { url } = await callApi<{ url: string }>('work.file_url', { task_id: taskId, path });
  window.open(url, '_blank', 'noopener');
}

export function Evidence({ sub, taskId }: { sub: Pick<SubmissionRow, 'links' | 'files' | 'note'>; taskId: string }) {
  const toast = useToast();
  if (!sub.links?.length && !sub.files?.length && !sub.note) return <p className="text-[14px] text-ink-3">Chưa có bằng chứng.</p>;
  return (
    <div className="flex flex-col gap-1.5 text-[14px]">
      {sub.links?.map((l) => (
        <a key={l} href={l} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 break-all text-brand underline">
          <Icon name="link" size={14} className="shrink-0" />
          {l}
        </a>
      ))}
      {sub.files?.map((f) => (
        <button key={f.path} type="button" className="inline-flex items-center gap-1.5 text-left text-brand underline" onClick={() => openFile(taskId, f.path).catch((e) => toast((e as Error).message, 'bad'))}>
          <Icon name="file" size={14} className="shrink-0" />
          {f.name} <span className="text-[12px] text-ink-3">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
        </button>
      ))}
      {sub.note && <p className="whitespace-pre-wrap text-ink-2">“{sub.note}”</p>}
    </div>
  );
}

/** Task detail with the actions the viewer is allowed to take (PRD 3, 6.3–6.4, 7.2). */
export function TaskDrawer({ task, people, onClose, onChanged, initialPanel = null }: { task: Task | null; people: PersonRow[]; onClose: () => void; onChanged: () => void; initialPanel?: Panel }) {
  const me = useProfile();
  const { tz } = useSettings();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const hist = useAsync(() => (task ? loadTaskHistory(task.id) : Promise.resolve(null)), [task?.id, task?.state, task?.due_date]);
  useEffect(() => setPanel(initialPanel), [task?.id, initialPanel]);
  if (!task) return null;
  const actor = { role: me.role, isAssignee: isMine(task, me.id), isProjectPm: isProjectPm(task.project, me) };
  const can = (a: Parameters<typeof whyNot>[0]) => whyNot(a, task.state, actor) === null;
  const addEvidence = actor.isAssignee && task.state === 'review' && !task.hasEvidence;
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name ?? '';
  const done = async (msg: string) => {
    toast(msg);
    setPanel(null);
    onChanged();
  };
  const fmtAt = (s: string) => new Date(s).toLocaleString('vi-VN', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[15px] text-brand">{task.code}</span>
          {task.name}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <StageBadge state={task.state} />
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <HealthDot health={task.health} /> {task.reason}
          </span>
          {task.progress && (task.state === 'doing' || task.state === 'changes') && <Badge tone={task.progress === 'blocked' ? 'bad' : task.progress === 'behind' ? 'warn' : 'ok'}>{PROGRESS_LABEL[task.progress]}</Badge>}
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-[12.5px] text-ink-3">Dự án</dt>
            <dd className="flex items-center gap-1.5">
              <ProjectSwatch color={task.project.color} /> {task.project.code} · {task.project.name}
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Người thực hiện</dt>
            <dd>{task.assignee_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Deadline</dt>
            <dd>
              {fmtDueDate(task.due_date)}
              {task.kpi_due_date && task.kpi_due_date !== task.due_date && <span className="ml-1 text-[12.5px] text-ink-3">(tính KPI theo {fmtDueDate(task.kpi_due_date)})</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Mức nhắc</dt>
            <dd>
              {TIER_LABEL[task.tier ?? autoTier(task.start_date, task.due_date)]} <span className="text-[12.5px] text-ink-3">({tierHint(task.tier ?? autoTier(task.start_date, task.due_date))})</span>
            </dd>
          </div>
        </dl>

        <Section title="Kết quả cần nộp">
          <p className="whitespace-pre-wrap text-[14.5px] text-ink">{task.expected_output || <span className="text-ink-3">Chưa ghi.</span>}</p>
          {task.description && <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink-2">{task.description}</p>}
        </Section>

        {task.progress === 'blocked' && (task.state === 'doing' || task.state === 'changes') && (
          <Banner
            tone="bad"
            title="Bị chặn"
            actions={
              actor.isAssignee || actor.isProjectPm ? (
                <Button size="sm" variant="secondary" onClick={() => callApi('work.unblock', { task_id: task.id }).then(() => done('Đã gỡ trạng thái bị chặn'), (e) => toast(e.message, 'bad'))}>
                  {actor.isAssignee ? 'Đã gỡ' : 'Đã xử lý'}
                </Button>
              ) : undefined
            }
          >
            {task.progress_note || 'Chưa ghi lý do.'}
          </Banner>
        )}

        {task.state === 'review' && (
          <Section title={`Lần nộp đang chờ duyệt${task.pending ? ` · ${fmtAt(task.pending.submitted_at)}${task.pending.via === 'lark' ? ' (đánh dấu trên Lark)' : ''}` : ''}`}>
            {task.pending ? <Evidence sub={task.pending} taskId={task.id} /> : <p className="text-ink-3">—</p>}
            {!task.hasEvidence && <p className="mt-1 text-[13px] text-warn">Chưa có bằng chứng. Thêm link hoặc file để PM duyệt.</p>}
          </Section>
        )}

        {/* actions */}
        <div className="flex flex-wrap gap-2">
          {(can('submit') || addEvidence) && (
            <Button icon="upload" onClick={() => setPanel('submit')}>
              {addEvidence ? 'Thêm bằng chứng' : task.state === 'changes' ? 'Nộp lại kết quả' : 'Nộp kết quả'}
            </Button>
          )}
          {can('progress') && (
            <Button variant="secondary" onClick={() => setPanel('progress')}>
              Báo tiến độ
            </Button>
          )}
          {can('approve') && (
            <Button icon="check" onClick={() => setPanel('review')}>
              Duyệt / Yêu cầu sửa
            </Button>
          )}
          {can('extend') && (
            <Button variant="secondary" icon="clock" onClick={() => setPanel('extend')}>
              Gia hạn
            </Button>
          )}
          {actor.isProjectPm && (task.state === 'doing' || task.state === 'changes') && (
            <Button variant="secondary" icon="edit" onClick={() => setPanel('edit')}>
              Sửa task
            </Button>
          )}
          {can('cancel') && (
            <Button variant="ghost" icon="trash" onClick={() => setPanel('cancel')}>
              Huỷ task
            </Button>
          )}
          {can('reopen') && (
            <Button variant="ghost" onClick={() => setPanel('reopen')}>
              Mở lại
            </Button>
          )}
          {task.lark_url && (
            <a className="inline-flex min-h-[40px] items-center gap-1.5 px-2 text-[14px] font-semibold text-brand underline" href={task.lark_url} target="_blank" rel="noreferrer">
              Mở trên Lark
            </a>
          )}
        </div>

        {panel === 'submit' && <SubmitForm task={task} onDone={() => done(addEvidence ? 'Đã thêm bằng chứng' : 'Đã nộp, chờ PM duyệt')} onCancel={() => setPanel(null)} />}
        {panel === 'progress' && <ProgressForm task={task} onDone={() => done('Đã ghi nhận tiến độ')} onCancel={() => setPanel(null)} />}
        {panel === 'review' && <ReviewForm task={task} onDone={(m) => done(m)} onCancel={() => setPanel(null)} />}
        {panel === 'extend' && <ExtendForm task={task} onDone={() => done('Đã gia hạn')} onCancel={() => setPanel(null)} />}
        {panel === 'edit' && <TaskForm project={task.project} members={people} task={task} onDone={() => done('Đã lưu task')} onCancel={() => setPanel(null)} />}
        {panel === 'cancel' && <ReasonForm label="Lý do huỷ task" action="work.cancel" taskId={task.id} button="Huỷ task" onDone={() => done('Đã huỷ task')} onCancel={() => setPanel(null)} />}
        {panel === 'reopen' && <ReasonForm label="Lý do mở lại" action="work.reopen" taskId={task.id} button="Mở lại task" onDone={() => done('Đã mở lại task')} onCancel={() => setPanel(null)} />}

        <Section title="Lịch sử">
          {hist.loading ? (
            <Loading />
          ) : !hist.data ? null : (
            <ol className="flex flex-col gap-3 text-[14px]">
              {hist.data.submissions.map((s) => (
                <li key={s.id} className="rounded-lg bg-white px-3 py-2.5 shadow-sheet">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b>
                      Lần nộp {s.round}
                      {s.via === 'lark' ? ' (Lark)' : ''}
                    </b>
                    <span className="text-[12.5px] text-ink-3">{fmtAt(s.submitted_at)}</span>
                  </div>
                  <div className="mt-1.5">
                    <Evidence sub={s} taskId={task.id} />
                  </div>
                  {s.decision && (
                    <div className={cx('mt-2 rounded-md px-2.5 py-1.5 text-[13.5px]', s.decision === 'approved' ? 'bg-ok-soft text-ok-ink' : 'bg-warn-soft text-warn')}>
                      <b>{s.decision === 'approved' ? 'Đã duyệt' : 'Yêu cầu sửa'}</b>
                      {s.decided_by && ` · ${nameOf(s.decided_by)}`}
                      {s.decided_at && ` · ${fmtAt(s.decided_at)}`}
                      {s.feedback && <p className="mt-1 whitespace-pre-wrap text-ink">{s.feedback}</p>}
                    </div>
                  )}
                </li>
              ))}
              {hist.data.extensions.map((x) => (
                <li key={x.id} className="text-[13.5px] text-ink-2">
                  📅 {fmtAt(x.created_at)} · Gia hạn {fmtDueDate(x.from_date)} → {fmtDueDate(x.to_date)} · {EXTEND_REASON_LABEL[x.reason]}
                  {x.created_by && ` · ${nameOf(x.created_by)}`}
                </li>
              ))}
              {hist.data.checkins
                .filter((c) => c.sent_at)
                .map((c) => (
                  <li key={c.pct} className="text-[13.5px] text-ink-2">
                    📍 Hỏi tiến độ mốc {c.pct}% ({fmtDueDate(c.due_date)}): {c.answer ? `${PROGRESS_LABEL[c.answer]}${c.answer_reason ? ` · ${c.answer_reason}` : ''}` : 'chưa trả lời'}
                  </li>
                ))}
              {!hist.data.submissions.length && !hist.data.extensions.length && !hist.data.checkins.some((c) => c.sent_at) && <li className="text-ink-3">Chưa có lần nộp hay thay đổi nào.</li>}
            </ol>
          )}
        </Section>
      </div>
    </Modal>
  );
}

function FormBox({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="rounded-xl border border-brand-line bg-brand-soft/40 p-4">
      <h3 className="mb-3 text-[15px] font-semibold text-ink">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div>
    </div>
  );
}

function SubmitForm({ task, onDone, onCancel }: { task: Task; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [links, setLinks] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const linkList = links.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const badLinks = linkList.filter((l) => !/^https?:\/\/\S+$/i.test(l));
  const tooBig = files.filter((f) => f.size > MAX_EVIDENCE_BYTES);
  const ready = (linkList.length > 0 || files.length > 0) && !badLinks.length && !tooBig.length;
  async function submit() {
    setBusy(true);
    try {
      const uploaded: { path: string; name: string; size: number }[] = [];
      for (const f of files) {
        const u = await callApi<{ path: string; token: string }>('work.upload_url', { task_id: task.id, name: f.name, size: f.size });
        const { error } = await supabase.storage.from('task-evidence').uploadToSignedUrl(u.path, u.token, f);
        if (error) throw new Error(`Tải "${f.name}" lên chưa được: ${error.message}`);
        uploaded.push({ path: u.path, name: f.name, size: f.size });
      }
      await callApi('work.submit', { task_id: task.id, links: linkList, files: uploaded, note });
      onDone();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormBox
      title="Nộp kết quả"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Huỷ
          </Button>
          <Button icon="send" busy={busy} disabled={!ready} onClick={submit}>
            Nộp cho PM duyệt
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-ink-2">
        Đối chiếu với <b>Kết quả cần nộp</b> ở trên. Cần ít nhất 1 link hoặc 1 file.
      </p>
      <Field label="Link kết quả (mỗi link một dòng)" error={badLinks.length ? `Link chưa đúng: ${badLinks.join(', ')}` : undefined}>
        {(id) => <Textarea id={id} rows={3} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://drive.google.com/…" />}
      </Field>
      <Field label="File (mỗi file tối đa 20 MB)" error={tooBig.length ? `Quá 20 MB: ${tooBig.map((f) => f.name).join(', ')}. Tải lên Drive rồi dán link.` : undefined}>
        {(id) => <input id={id} type="file" multiple className="text-[14px]" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />}
      </Field>
      <Field label="Ghi chú cho PM (không bắt buộc)">{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </FormBox>
  );
}

function ProgressForm({ task, onDone, onCancel }: { task: Task; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [answer, setAnswer] = useState<'on_plan' | 'behind' | 'blocked'>('on_plan');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <FormBox
      title="Báo tiến độ"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Huỷ
          </Button>
          <Button
            busy={busy}
            disabled={answer === 'blocked' && !reason.trim()}
            onClick={() => {
              setBusy(true);
              callApi('work.progress', { task_id: task.id, answer, reason })
                .then(onDone, (e) => toast(e.message, 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            Gửi
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Tiến độ" className="flex flex-wrap gap-2">
        {(['on_plan', 'behind', 'blocked'] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={answer === a}
            onClick={() => setAnswer(a)}
            className={cx('min-h-[40px] rounded-lg border px-4 text-[14.5px] font-semibold transition-colors', answer === a ? (a === 'blocked' ? 'border-bad bg-bad text-white' : a === 'behind' ? 'border-warn bg-warn text-white' : 'border-ok bg-ok text-white') : 'border-line bg-white text-ink-2 hover:border-ink-3')}
          >
            {PROGRESS_LABEL[a]}
          </button>
        ))}
      </div>
      <Field label={answer === 'blocked' ? 'Lý do bị chặn (bắt buộc) — PM sẽ được báo ngay' : 'Ghi chú (không bắt buộc)'}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </FormBox>
  );
}

function ReviewForm({ task, onDone, onCancel }: { task: Task; onDone: (msg: string) => void; onCancel: () => void }) {
  const toast = useToast();
  const { tz } = useSettings();
  const [mode, setMode] = useState<'approve' | 'changes'>('approve');
  const [feedback, setFeedback] = useState('');
  const [extend, setExtend] = useState(false);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState<ExtendReason | ''>('');
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  const extErr = extend ? extensionErrors({ dueDate: task.due_date }, to || null, reason || null, task.project.due_date, today) : [];
  const ready = mode === 'approve' ? task.hasEvidence : !!feedback.trim() && !extErr.length;
  return (
    <FormBox
      title="Duyệt kết quả"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Huỷ
          </Button>
          <Button
            busy={busy}
            disabled={!ready}
            variant={mode === 'approve' ? 'primary' : 'secondary'}
            onClick={() => {
              setBusy(true);
              callApi('work.review', { task_id: task.id, decision: mode, feedback, ...(mode === 'changes' && extend ? { extend_to: to, extend_reason: reason } : {}) })
                .then(() => onDone(mode === 'approve' ? `Đã duyệt ${task.code}` : `Đã gửi góp ý cho ${task.code}`), (e) => toast(e.message, 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            {mode === 'approve' ? 'Duyệt' : 'Gửi yêu cầu sửa'}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Quyết định" className="flex flex-wrap gap-2">
        {(
          [
            ['approve', 'Đạt — duyệt'],
            ['changes', 'Chưa đạt — yêu cầu sửa'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cx('min-h-[40px] rounded-lg border px-4 text-[14.5px] font-semibold', mode === k ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-2 hover:border-ink-3')}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'approve' && !task.hasEvidence && <Banner tone="warn">Chưa có bằng chứng: chờ bổ sung, hoặc yêu cầu sửa.</Banner>}
      <Field label={mode === 'changes' ? 'Góp ý (bắt buộc): cần cải thiện gì, sửa gì' : 'Ghi chú (không bắt buộc)'}>{(id) => <Textarea id={id} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />}</Field>
      {mode === 'changes' && (
        <>
          <label className="flex items-center gap-2 text-[14px] text-ink-2">
            <input type="checkbox" className="h-4 w-4" checked={extend} onChange={(e) => setExtend(e.target.checked)} /> Gia hạn deadline (hiện tại {fmtDueDate(task.due_date)})
          </label>
          {extend && <ExtendFields to={to} setTo={setTo} reason={reason} setReason={setReason} errors={to || reason ? extErr : []} max={task.project.due_date} kpiDue={task.kpi_due_date ?? task.due_date} />}
        </>
      )}
    </FormBox>
  );
}

/**
 * The two extension reasons as explicit choices, each showing what it does to the KPI deadline.
 * scope: KPI deadline moves to the new date. quality: KPI deadline stays where it was.
 */
export function ExtendReasonPicker({ value, onChange, newDue, kpiDue }: { value: ExtendReason | ''; onChange: (v: ExtendReason) => void; newDue: string; kpiDue: string; subject?: 'task' | 'project' }) {
  const opts: { k: ExtendReason; title: string; effect: string; tone: 'ok' | 'warn' }[] = [
    { k: 'scope', title: 'Yêu cầu thay đổi', effect: `Hạn KPI dời sang ${newDue ? fmtDueDate(newDue) : 'ngày mới'} · không tính trễ`, tone: 'ok' },
    {
      k: 'quality',
      title: 'Người làm cần thêm thời gian',
      effect: `Hạn KPI giữ ${fmtDueDate(kpiDue)} · nộp sau vẫn tính trễ`,
      tone: 'warn',
    },
  ];
  return (
    <div role="radiogroup" aria-label="Lý do gia hạn" className="grid gap-2 sm:grid-cols-2">
      {opts.map((o) => {
        const on = value === o.k;
        return (
          <button
            key={o.k}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.k)}
            className={cx('flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors', on ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-white hover:border-ink-3')}
          >
            <span className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
              <span className={cx('grid h-4 w-4 shrink-0 place-items-center rounded-full border', on ? 'border-brand' : 'border-ink-3')}>{on && <span className="h-2 w-2 rounded-full bg-brand" />}</span>
              {o.title}
            </span>
            <span className="text-[13px] leading-snug text-ink-2">{EXTEND_REASON_HINT[o.k]}</span>
            <span className={cx('mt-1 rounded-md px-2 py-1 text-[12.5px] font-medium', o.tone === 'ok' ? 'bg-ok-soft text-ok-ink' : 'bg-warn-soft text-warn')}>{o.effect}</span>
          </button>
        );
      })}
    </div>
  );
}

function ExtendFields({ to, setTo, reason, setReason, errors, max, kpiDue, overdue }: { to: string; setTo: (v: string) => void; reason: ExtendReason | ''; setReason: (v: ExtendReason) => void; errors: string[]; max: string; kpiDue: string; overdue?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {overdue && <Banner tone="warn">Task quá hạn từ {fmtDueDate(kpiDue)}. Gia hạn không xoá việc trễ, trừ khi do yêu cầu thay đổi.</Banner>}
      <Field label="Deadline mới" hint={`Không sau deadline dự án ${fmtDueDate(max)}`}>
        {(id) => <Input id={id} type="date" value={to} max={max} onChange={(e) => setTo(e.target.value)} className="sm:max-w-[220px]" />}
      </Field>
      <Field label="Vì sao phải gia hạn?" hint="Quyết định task có bị tính trễ không.">
        {() => <ExtendReasonPicker value={reason} onChange={setReason} newDue={to} kpiDue={kpiDue} />}
      </Field>
      {errors.length > 0 && <p className="text-[13px] text-bad">{errors.join(' ')}</p>}
    </div>
  );
}

function ExtendForm({ task, onDone, onCancel }: { task: Task; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const { tz } = useSettings();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState<ExtendReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  const errs = extensionErrors({ dueDate: task.due_date }, to || null, reason || null, task.project.due_date, today);
  return (
    <FormBox
      title={`Gia hạn (hiện tại ${fmtDueDate(task.due_date)})`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Huỷ
          </Button>
          <Button
            busy={busy}
            disabled={errs.length > 0}
            onClick={() => {
              setBusy(true);
              callApi('work.extend', { task_id: task.id, to, reason, note })
                .then(onDone, (e) => toast(e.message, 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            Gia hạn
          </Button>
        </>
      }
    >
      <ExtendFields to={to} setTo={setTo} reason={reason} setReason={setReason} errors={to || reason ? errs : []} max={task.project.due_date} kpiDue={task.kpi_due_date ?? task.due_date} overdue={task.due_date < today} />
      <Field label="Ghi chú (không bắt buộc)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </FormBox>
  );
}

function ReasonForm({ label, action, taskId, button, onDone, onCancel }: { label: string; action: string; taskId: string; button: string; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <FormBox
      title={button}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Thôi
          </Button>
          <Button
            variant="danger"
            busy={busy}
            disabled={!reason.trim()}
            onClick={() => {
              setBusy(true);
              callApi(action, { task_id: taskId, reason })
                .then(onDone, (e) => toast(e.message, 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            {button}
          </Button>
        </>
      }
    >
      <Field label={label}>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </FormBox>
  );
}

// ----------------------------------------------------------------------------- task form --------

/** Create or edit a task (PM). The code is generated: MT35-01, MT35-02 … */
export function TaskForm({ project, members, task, onDone, onCancel }: { project: Project | ProjectRow; members: PersonRow[]; task?: Task; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const { tz } = useSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  // Only members who accepted the invitation can be given a task (23/11).
  const accepted = 'members' in project ? new Set(project.members.filter((m) => m.status === 'accepted').map((m) => m.profile_id).filter(Boolean)) : null;
  const pending = 'members' in project ? project.members.filter((m) => m.status === 'invited').length : 0;
  const choices = members.filter((p) => p.active && !['admin', 'ceo', 'pm'].includes(p.role));
  const list = accepted ? choices.filter((p) => accepted.has(p.id)) : choices;
  const firstDay = project.start_date > today ? project.start_date : today;
  const [f, setF] = useState({
    name: task?.name ?? '',
    expected_output: task?.expected_output ?? '',
    description: task?.description ?? '',
    assignee_id: task?.assignee_id ?? '',
    start_date: task?.start_date ?? firstDay,
    due_date: task?.due_date ?? '',
    tier: task?.tier ?? '',
  });
  const [busy, setBusy] = useState(false);
  const autoT: ReminderTier | null = f.start_date && f.due_date && f.due_date > f.start_date ? autoTier(f.start_date, f.due_date) : null;
  const errs = !task && (f.due_date || f.start_date < project.start_date) ? taskDateErrors({ startDate: f.start_date, dueDate: f.due_date || null }, { startDate: project.start_date, dueDate: project.due_date }, today).filter((e) => f.due_date || !e.startsWith('Thiếu')) : [];
  const ready = f.name.trim() && f.expected_output.trim() && f.assignee_id && (task || (f.due_date && !errs.length));
  async function save() {
    setBusy(true);
    try {
      if (task) await callApi('work.task_update', { task_id: task.id, name: f.name, expected_output: f.expected_output, description: f.description, assignee_id: f.assignee_id, tier: f.tier || null });
      else await callApi('work.task_create', { project_id: project.id, ...f, tier: f.tier || null });
      onDone();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormBox
      title={task ? `Sửa ${task.code}` : `Task mới · mã ${taskCode(project.code, project.next_seq)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Huỷ
          </Button>
          <Button busy={busy} disabled={!ready} onClick={save}>
            {task ? 'Lưu' : 'Tạo task'}
          </Button>
        </>
      }
    >
      <Field label="Tên task">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="VD: Push 50 KOC gửi video" />}</Field>
      <Field label="Kết quả cần nộp" hint="PM sẽ đối chiếu với mục này khi duyệt.">
        {(id) => <Textarea id={id} rows={2} value={f.expected_output} onChange={(e) => setF({ ...f, expected_output: e.target.value })} placeholder="VD: 50 video đã đăng + file tổng hợp link" />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Người thực hiện" hint={!list.length ? `Chưa có thành viên nào nhận lời mời${pending ? ` (${pending} đang chờ trả lời)` : ''}. Mời ở tab Thành viên.` : pending ? `${pending} người chưa trả lời lời mời nên chưa chọn được.` : undefined}>
          {(id) => (
            <Select id={id} value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })}>
              <option value="">Chọn…</option>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Mức nhắc" hint={autoT && !f.tier ? `Tự động: ${TIER_LABEL[autoT]} — ${tierHint(autoT)}` : f.tier ? tierHint(f.tier as ReminderTier) : undefined}>
          {(id) => (
            <Select id={id} value={f.tier ?? ''} onChange={(e) => setF({ ...f, tier: e.target.value as ReminderTier | '' })}>
              <option value="">Tự động theo thời lượng</option>
              <option value="short">Ngắn</option>
              <option value="medium">Vừa</option>
              <option value="long">Dài</option>
            </Select>
          )}
        </Field>
        {!task && (
          <>
            <Field label="Ngày bắt đầu" hint={`Không trước ngày bắt đầu dự án ${fmtDueDate(project.start_date)}`}>
              {(id) => <Input id={id} type="date" value={f.start_date} min={project.start_date} max={project.due_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />}
            </Field>
            <Field label="Deadline" hint={`Không sau deadline dự án ${fmtDueDate(project.due_date)}`}>
              {(id) => <Input id={id} type="date" value={f.due_date} min={f.start_date > today ? f.start_date : today} max={project.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />}
            </Field>
          </>
        )}
      </div>
      {errs.length > 0 && <p className="text-[13px] text-bad">{errs.join(' ')}</p>}
      <Field label="Mô tả (không bắt buộc)">{(id) => <Textarea id={id} rows={2} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
    </FormBox>
  );
}

// --------------------------------------------------------------------------- project form --------

interface Chat {
  chat_id: string;
  name: string;
  used_by: string | null;
  used_by_id: string | null;
}

export function ChatPicker({ code, name, projectId, value, onChange }: { code: string; name: string; projectId?: string; value: string; onChange: (id: string) => void }) {
  const toast = useToast();
  const chats = useAsync(() => callApi<{ mode: string; chats: Chat[]; codes: string[] }>('work.chats', { refresh: true }), []);
  const [busy, setBusy] = useState<'' | 'create' | 'delete'>('');
  const list = chats.data?.chats ?? [];
  const otherCodes = (chats.data?.codes ?? []).filter((c) => c !== normalizeProjectCode(code));
  const takenBy = (c: Chat) => (c.used_by_id && c.used_by_id !== projectId ? c.used_by : null);
  const clash = (c: Chat) => (code ? chatCodeConflict(c.name, code, otherCodes) : null);
  const usable = (c: Chat) => !takenBy(c) && !clash(c);
  const match = code ? list.find((c) => usable(c) && chatMatchesCode(c.name, code)) : undefined;
  useEffect(() => {
    if (!value && match) onChange(match.chat_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match?.chat_id]);
  const sim = chats.data?.mode === 'simulation';
  const codeOk = !checkProjectCode(code).length || (projectId !== undefined && PROJECT_CODE_RE.test(normalizeProjectCode(code)));
  const proposed = codeOk && name.trim() ? chatNameFor(code, name) : '';
  const unused = list.filter((c) => c.chat_id.startsWith('sim-chat:') && !c.used_by_id);
  const hasOwn = !!code && list.some((c) => chatMatchesCode(c.name, code) && usable(c));
  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Group Lark của dự án"
        hint={chats.loading ? 'Đang tải danh sách group…' : match ? `Đã chọn sẵn group có mã ${normalizeProjectCode(code)}.` : list.length ? `Chưa có group nào mang mã ${normalizeProjectCode(code) || 'dự án'}.` : 'Bot chưa ở group nào. Có thể gắn group sau.'}
      >
        {(id) => (
          <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Chưa gắn group (tin gửi riêng cho PM)</option>
            {list.map((c) => (
              <option key={c.chat_id} value={c.chat_id} disabled={!usable(c)}>
                {c.name}
                {takenBy(c) ? ` (đang gắn ${takenBy(c)})` : clash(c) ? ` (mã ${clash(c)} của dự án khác)` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {sim && (
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          {!hasOwn && (
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              busy={busy === 'create'}
              disabled={!proposed}
              title={proposed ? '' : 'Nhập mã và tên dự án trước'}
              onClick={() => {
                setBusy('create');
                callApi<{ chat: Chat }>('work.chat_create_sim', { code, name, project_id: projectId })
                  .then((r) => (chats.reload(), onChange(r.chat.chat_id)), (e) => toast(e.message, 'bad'))
                  .finally(() => setBusy(''));
              }}
            >
              {proposed ? `Tạo group “${proposed}”` : 'Tạo group (nhập mã, tên dự án trước)'}
            </Button>
          )}
          <span className="text-[12.5px] text-ink-3">Mô phỏng Lark</span>
        </div>
      )}
      {sim && unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-ink-3">Group chưa dùng:</span>
          {unused.map((c) => (
            <span key={c.chat_id} className="inline-flex items-center gap-1 rounded-full border border-line bg-white py-0.5 pl-2.5 pr-1 text-ink-2">
              {c.name}
              <button
                type="button"
                aria-label={`Xoá group ${c.name}`}
                title="Xoá group tạo nhầm"
                disabled={!!busy}
                className="grid h-5 w-5 place-items-center rounded-full text-ink-3 hover:bg-bad-soft hover:text-bad"
                onClick={() => {
                  if (!window.confirm(`Xoá group mô phỏng "${c.name}"?`)) return;
                  setBusy('delete');
                  callApi('work.chat_delete_sim', { chat_id: c.chat_id })
                    .then(() => (value === c.chat_id && onChange(''), chats.reload(), toast('Đã xoá group')), (e) => toast(e.message, 'bad'))
                    .finally(() => setBusy(''));
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectForm({ project, people, existingCodes, onDone, onCancel, fromQuoteId }: { project?: Project; people: PersonRow[]; existingCodes: string[]; onDone: (code: string) => void; onCancel: () => void; fromQuoteId?: string }) {
  const toast = useToast();
  const { tz } = useSettings();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  const [f, setF] = useState({
    code: project?.code ?? '',
    name: project?.name ?? '',
    client: project?.client ?? '',
    description: project?.description ?? '',
    start_date: project?.start_date ?? today,
    due_date: project?.due_date ?? '',
    color: project?.color ?? '',
    chat_id: project?.chat_id ?? '',
  });
  const [reason, setReason] = useState<ExtendReason | ''>('');
  const [members, setMembers] = useState<string[]>([]);
  const me = useProfile();
  // 1.7: create from a won quote; the fields are filled from it and stay editable.
  const won = useAsync(() => (project ? Promise.resolve([] as WonQuote[]) : loadWonQuotes(me)), [project?.id]);
  const [quoteId, setQuoteId] = useState('');
  const pickQuote = (id: string) => {
    setQuoteId(id);
    const q = won.data?.find((x) => x.id === id);
    if (q) setF((x) => ({ ...x, name: q.project || q.client || x.name, client: q.client || x.client, description: [q.venue && `Địa điểm: ${q.venue}`, q.contact && `Liên hệ: ${q.contact}`].filter(Boolean).join(' · ') || x.description }));
  };
  useEffect(() => {
    if (fromQuoteId && won.data?.some((x) => x.id === fromQuoteId)) pickQuote(fromQuoteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromQuoteId, won.data]);
  const [busy, setBusy] = useState(false);
  const code = normalizeProjectCode(f.code);
  const codeErr = project ? [] : f.code ? checkProjectCode(code, existingCodes) : [];
  const dueChanged = !!project && f.due_date !== project.due_date;
  const errs: string[] = [];
  if (f.due_date && f.due_date <= f.start_date) errs.push('Deadline dự án phải sau ngày bắt đầu.');
  if (!project && f.due_date && f.due_date < today) errs.push('Deadline đã qua.');
  if (dueChanged && !reason) errs.push('Chọn lý do đổi deadline dự án.');
  const ready = (project || (code && !codeErr.length)) && f.name.trim() && f.due_date && !errs.length;
  const staff = useMemo(() => people.filter((p) => p.active && !['admin', 'ceo', 'pm'].includes(p.role)), [people]);
  async function save() {
    setBusy(true);
    try {
      if (project) {
        await callApi('work.project_update', { project_id: project.id, name: f.name, client: f.client, description: f.description, color: f.color, ...(dueChanged ? { due_date: f.due_date, reason } : {}), ...(f.chat_id && f.chat_id !== project.chat_id ? { chat_id: f.chat_id } : {}) });
        onDone(project.code);
      } else {
        const r = await callApi<{ project: ProjectRow }>('work.project_create', { ...f, code, chat_id: f.chat_id || undefined, member_ids: members, quote_id: quoteId || undefined });
        onDone(r.project.code);
      }
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      wide
      onClose={onCancel}
      title={project ? `Sửa dự án ${project.code}` : 'Dự án mới'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Huỷ
          </Button>
          <Button busy={busy} disabled={!ready} onClick={save}>
            {project ? 'Lưu' : 'Tạo dự án'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!project && (won.data?.length ?? 0) > 0 && (
          <Field label="Từ báo giá đã chốt (không bắt buộc)" hint="Điền sẵn tên, khách, mô tả">
            {(id) => (
              <Select id={id} value={quoteId} onChange={(e) => pickQuote(e.target.value)}>
                <option value="">Không dùng báo giá</option>
                {won.data!.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.code} · {q.client || '(chưa có khách)'}
                    {q.kind === 'project' ? ' · Dự án' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Mã dự án" error={codeErr[0]} hint={!project ? 'VD: MT35. Không đổi được sau khi có task.' : undefined}>
            {(id) => <Input id={id} className="font-mono uppercase" value={f.code} disabled={!!project} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="MT35" />}
          </Field>
          <Field label="Tên dự án">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="VD: Ra mắt BST Tết" />}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Khách hàng (không bắt buộc)">{(id) => <Input id={id} value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} />}</Field>
          <Field label="Ngày bắt đầu">{(id) => <Input id={id} type="date" value={f.start_date} disabled={!!project} onChange={(e) => setF({ ...f, start_date: e.target.value })} />}</Field>
          <Field label="Deadline dự án">{(id) => <Input id={id} type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />}</Field>
        </div>
        {dueChanged && (
          <Field label="Vì sao đổi deadline dự án?" hint="Deadline từng task không tự đổi.">
            {() => <ExtendReasonPicker value={reason} onChange={setReason} newDue={f.due_date} kpiDue={project!.kpi_due_date ?? project!.due_date} subject="project" />}
          </Field>
        )}
        {errs.length > 0 && <p className="text-[13px] text-bad">{errs.join(' ')}</p>}
        <ChatPicker code={code} name={f.name} projectId={project?.id} value={f.chat_id} onChange={(chat_id) => setF((x) => ({ ...x, chat_id }))} />
        {!project && (
          <Field label="Mời thành viên" hint="Họ nhận lời mời trong Inbox.">
            {() => (
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {staff.map((p) => {
                  const on = members.includes(p.id);
                  return (
                    <button key={p.id} type="button" aria-pressed={on} onClick={() => setMembers(on ? members.filter((x) => x !== p.id) : [...members, p.id])} className={cx('rounded-full border px-3 py-1 text-[13.5px]', on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-2 hover:border-ink-3')}>
                      {p.full_name || p.email}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        )}
        <Field label="Màu trên Calendar">
          {() => (
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Màu ${c}`} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} className={cx('h-7 w-7 rounded-md border-2', f.color === c ? 'border-ink' : 'border-transparent')} style={{ background: c }} />
              ))}
            </div>
          )}
        </Field>
        <Field label="Mô tả (không bắt buộc)">{(id) => <Textarea id={id} rows={2} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------- message history --------

export function MessageHistory({ messages }: { messages: BotMessageRow[] }) {
  const [onlyFailed, setOnlyFailed] = useState(false);
  const list = onlyFailed ? messages.filter((m) => m.status === 'failed') : messages;
  const days = [...new Set(list.map((m) => m.local_date))];
  if (!messages.length) return <EmptyState title="Chưa có tin nào">Tin bot gửi vào group dự án và tin gửi riêng sẽ hiện ở đây.</EmptyState>;
  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-[14px] text-ink-2">
        <input type="checkbox" className="h-4 w-4" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> Chỉ tin gửi lỗi
      </label>
      {days.map((d) => (
        <section key={d} className="mb-5">
          <h3 className="mb-2 text-[13px] font-semibold text-ink-3">{fmtDueDate(d)}</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list
              .filter((m) => m.local_date === d)
              .map((m) => (
                <div key={m.id}>
                  <BotCard message={m.message} time={m.sent_at ? new Date(m.sent_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : undefined} />
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[12px] text-ink-3">
                    <Badge tone={m.channel === 'dm' ? 'accent' : 'neutral'}>{m.channel === 'dm' ? `Riêng · ${m.to_name ?? '—'}` : 'Group dự án'}</Badge>
                    {m.status === 'sent' ? <Badge tone="ok">Đã gửi lên Lark</Badge> : m.status === 'failed' ? <Badge tone="bad">Lỗi gửi · lần {m.attempts}</Badge> : <Badge>Mô phỏng</Badge>}
                    {m.last_error && m.status === 'failed' && <span className="text-bad">{m.last_error}</span>}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
