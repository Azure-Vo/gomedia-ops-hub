import { ReactNode, useState } from 'react';
import { daysBetween, fmtDueDate, invitationErrors, PROGRESS_LABEL } from '@/domain';
import { Badge, Banner, Button, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Stat, Textarea, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { useProfile } from '@/lib/session';
import { InvitationRow, isMine, loadInvitations, Task } from './data';
import { TaskHost, useOpenTask, useWork } from './hooks';
import { DueText, HealthDot, ProjectSwatch, StageBadge } from './parts';

/** PRD 4.1 · Trang nhân sự: "Hôm nay tôi phải làm gì?" */
export function InboxPage() {
  const me = useProfile();
  const { data, loading, error, reload } = useWork();
  const invites = useAsync(loadInvitations, []);
  const { open } = useOpenTask(data);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const today = data.today;
  const mine = data.tasks.filter((t) => isMine(t, me.id));
  const open_ = mine.filter((t) => t.state === 'doing' || t.state === 'changes');
  const overdue = open_.filter((t) => t.due_date < today);
  const dueToday = open_.filter((t) => t.due_date === today);
  const changes = open_.filter((t) => t.state === 'changes' && t.due_date > today);
  const upcoming = open_.filter((t) => t.state === 'doing' && t.due_date > today && daysBetween(today, t.due_date) <= 7);
  const later = open_.filter((t) => t.state === 'doing' && daysBetween(today, t.due_date) > 7);
  const waiting = mine.filter((t) => t.state === 'review');
  const doneRecent = mine.filter((t) => t.state === 'done' && t.approved_at && daysBetween(t.approved_at.slice(0, 10), today) <= 30);
  const asked = open_.filter((t) => t.asked !== null);

  return (
    <div>
      <PageHeader title="Inbox" subtitle="Việc của bạn: quá hạn, hôm nay, cần sửa và sắp tới. Bấm vào task để nộp kết quả hoặc báo tiến độ." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Quá hạn" value={overdue.length} tone={overdue.length ? 'bad' : null} />
        <Stat label="Đến hạn hôm nay" value={dueToday.length} />
        <Stat label="Cần sửa" value={changes.length + open_.filter((t) => t.state === 'changes' && t.due_date <= today).length} />
        <Stat label="Chờ PM duyệt" value={waiting.length} />
      </div>
      {(invites.data ?? []).length > 0 && (
        <Invitations
          list={invites.data!}
          onAnswered={() => {
            invites.reload();
            reload();
          }}
        />
      )}
      {asked.length > 0 && (
        <Banner tone="info" title={`PM đang hỏi tiến độ ${asked.length} task`} className="mb-5">
          <div className="mt-1 flex flex-wrap gap-2">
            {asked.map((t) => (
              <Button key={t.id} size="sm" variant="secondary" onClick={() => open(t, 'progress')}>
                {t.code} · trả lời
              </Button>
            ))}
          </div>
        </Banner>
      )}
      {!mine.length && !(invites.data ?? []).length ? (
        <EmptyState title="Bạn chưa được giao task nào">Khi PM giao task, task sẽ hiện ở đây và bot nhắc trong group Lark của dự án.</EmptyState>
      ) : (
        <div className="flex flex-col gap-7">
          <Group title="Quá hạn" tone="bad" tasks={overdue} today={today} onOpen={open} empty="Không có task quá hạn." />
          <Group title="Hôm nay" tasks={dueToday} today={today} onOpen={open} empty="Không có task đến hạn hôm nay." />
          <Group title="Cần sửa" tone="warn" tasks={changes} today={today} onOpen={open} empty="Không có task bị trả lại." />
          <Group title="Sắp tới · 7 ngày" tasks={upcoming} today={today} onOpen={open} empty="Không có task đến hạn trong 7 ngày tới." />
          {later.length > 0 && <Group title="Sau 7 ngày" tasks={later} today={today} onOpen={open} />}
          {waiting.length > 0 && <Group title="Đã nộp · chờ PM duyệt" tasks={waiting} today={today} onOpen={open} />}
          <Group title="Đã xong · 30 ngày" tasks={doneRecent} today={today} onOpen={open} empty="Chưa có task được duyệt trong 30 ngày qua." />
        </div>
      )}
      <TaskHost data={data} reload={reload} />
    </div>
  );
}

/** PRD 1.6.1: invitations to projects, answered here. Declining needs a reason, which goes to the PM. */
function Invitations({ list, onAnswered }: { list: InvitationRow[]; onAnswered: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<InvitationRow | null>(null);
  const [reason, setReason] = useState('');
  const answer = async (inv: InvitationRow, accept: boolean, why = '') => {
    setBusy(inv.id);
    try {
      await callApi('work.invitation_respond', { project_id: inv.project_id, accept, reason: why });
      toast(accept ? `Đã tham gia ${inv.code}` : `Đã từ chối ${inv.code}, PM đã được báo`);
      setDeclining(null);
      setReason('');
      onAnswered();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mb-7 rounded-xl border border-brand-line bg-brand-soft/40 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-[17px] font-semibold text-ink">
        Lời mời tham gia dự án <Badge tone="brand">{list.length}</Badge>
      </h2>
      <ul className="flex flex-col gap-3">
        {list.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-4 py-3 shadow-sheet">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: inv.color ?? '#2F5BD3' }} />
                <span className="font-mono text-[14px] font-semibold text-brand">{inv.code}</span>
                <b className="text-ink">{inv.name}</b>
              </div>
              <div className="mt-0.5 text-[13px] text-ink-3">
                {[inv.client, `PM ${inv.pm_name ?? '—'}`, `${fmtDueDate(inv.start_date)} → ${fmtDueDate(inv.due_date)}`, inv.invited_at ? `mời ngày ${fmtDueDate(inv.invited_at.slice(0, 10))}` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy === inv.id} onClick={() => setDeclining(inv)}>
                Từ chối
              </Button>
              <Button icon="check" busy={busy === inv.id} onClick={() => answer(inv, true)}>
                Tham gia
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {declining && (
        <Modal
          open
          onClose={() => setDeclining(null)}
          title={`Từ chối tham gia ${declining.code}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeclining(null)}>
                Thôi
              </Button>
              <Button variant="danger" busy={busy === declining.id} disabled={invitationErrors(false, reason).length > 0} onClick={() => answer(declining, false, reason)}>
                Từ chối
              </Button>
            </>
          }
        >
          <p className="mb-3 text-[14px] text-ink-2">Lý do sẽ được gửi cho PM {declining.pm_name ?? ''} qua Lark và hiện ở trang dự án.</p>
          <Field label="Lý do (bắt buộc)">{(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Tuần này đang kín lịch với dự án DA058" />}</Field>
        </Modal>
      )}
    </section>
  );
}

function Group({ title, tasks, today, onOpen, empty, tone }: { title: string; tasks: Task[]; today: string; onOpen: (t: Task, d?: 'submit' | 'progress') => void; empty?: ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <section className="border-t border-ink pt-3">
      <h2 className="mb-2 flex items-center gap-2 text-[17px] font-semibold text-ink">
        {title}
        <Badge tone={tasks.length ? (tone ?? 'neutral') : 'neutral'}>{tasks.length}</Badge>
      </h2>
      {!tasks.length ? (
        <p className="text-[14px] text-ink-3">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <HealthDot health={t.health} reason={t.reason} />
              <button type="button" onClick={() => onOpen(t)} className="min-w-0 flex-1 basis-64 text-left">
                <div className="font-medium text-ink hover:text-brand">
                  <span className="mr-2 font-mono text-[13px] text-brand">{t.code}</span>
                  {t.name}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
                  <span className="inline-flex items-center gap-1.5">
                    <ProjectSwatch color={t.project.color} /> {t.project.code} · {t.project.name}
                  </span>
                  {t.state === 'done' && t.approved_at ? <span>Duyệt {fmtDueDate(t.approved_at.slice(0, 10))}</span> : <DueText task={t} today={today} />}
                  {t.progress && (t.state === 'doing' || t.state === 'changes') && <span>· {PROGRESS_LABEL[t.progress]}</span>}
                </div>
              </button>
              <StageBadge state={t.state} />
              {(t.state === 'doing' || t.state === 'changes') && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => onOpen(t, 'progress')}>
                    Báo tiến độ
                  </Button>
                  <Button size="sm" icon="upload" onClick={() => onOpen(t, 'submit')}>
                    {t.state === 'changes' ? 'Nộp lại' : 'Nộp kết quả'}
                  </Button>
                </div>
              )}
              {t.state === 'review' && !t.hasEvidence && (
                <Button size="sm" icon="upload" onClick={() => onOpen(t, 'submit')}>
                  Thêm bằng chứng
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
