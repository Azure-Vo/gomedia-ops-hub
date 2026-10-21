import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Answer, ANSWER_LABEL, checkpointIndex } from '@/domain';
import { Banner, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, PageHeader, Textarea, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnShort } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { CheckpointRow, liveCheckpoint, loadTasks, TaskRow } from './data';
import { BlockerModal, MilestonePills, TaskStatusBadge } from './parts';

export function MyCheckinsPage() {
  const me = useProfile();
  const { tz } = useSettings();
  const toast = useToast();
  const [blocker, setBlocker] = useState<TaskRow | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { mode: Answer | null; evidence: string; reason: string }>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const bundle = await loadTasks({ ownerId: me.id, open: true });
    const tg = check(await supabase.rpc('my_telegram')) as { linked: boolean };
    return { ...bundle, linked: tg.linked };
  }, [me.id]);

  async function answer(cp: CheckpointRow, a: Answer) {
    const d = drafts[cp.id] ?? { mode: null, evidence: '', reason: '' };
    setBusy(cp.id);
    try {
      await callApi('checkin.answer', { checkpoint_id: cp.id, answer: a, reason: a === 'blocked' ? d.reason : null, evidence_url: a === 'on_plan' ? d.evidence : null });
      toast(a === 'on_plan' ? 'Đã ghi nhận mốc hoàn thành' : a === 'behind' ? 'Đã ghi nhận, Executive sẽ được báo để hỗ trợ' : 'Đã báo E-commerce Executive ngay');
      setDrafts((x) => ({ ...x, [cp.id]: { mode: null, evidence: '', reason: '' } }));
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  const set = (id: number, patch: Partial<{ mode: Answer | null; evidence: string; reason: string }>) =>
    setDrafts((x) => ({ ...x, [id]: { ...(x[id] ?? { mode: null, evidence: '', reason: '' }), ...patch } }));

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = data!.tasks
    .map((t) => {
      const cps = data!.checkpoints.filter((c) => c.task_id === t.id);
      return { t, cps, ms: data!.milestones.filter((m) => m.task_id === t.id), live: liveCheckpoint(cps) };
    })
    .sort((a, b) => Number(!!b.live) - Number(!!a.live) || Date.parse(a.t.due_at) - Date.parse(b.t.due_at));
  const waiting = items.filter((i) => i.live);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Check-in của tôi" subtitle="Trả lời theo tình trạng thật của mốc đã lên kế hoạch. Chỉ mất vài giây." />
      {!data!.linked && (
        <Banner
          tone="info"
          title="Muốn nhận check-in qua Telegram?"
          actions={
            <Link to="/profile" className="inline-flex min-h-[44px] items-center rounded-[10px] bg-brand px-4 font-semibold text-white">
              Liên kết Telegram
            </Link>
          }
        >
          Chưa liên kết thì bạn trả lời ngay tại trang này. Bot chỉ nhắn trong giờ làm việc.
        </Banner>
      )}
      <Card title={`Cần trả lời (${waiting.length})`}>
        {!waiting.length ? (
          <EmptyState title="Không có checkpoint nào đang chờ bạn">Bot hỏi ở 25%, 50%, 75% và 99% thời gian làm việc của mỗi task.</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {waiting.map(({ t, live, ms }) => {
              const cp = live as CheckpointRow;
              const k = checkpointIndex(cp.pct);
              const m = ms.find((x) => x.idx === k);
              const d = drafts[cp.id] ?? { mode: null, evidence: '', reason: '' };
              return (
                <div key={cp.id} className="rounded-xl border-[1.5px] border-brand-line bg-brand-soft/40 p-4">
                  <div className="text-[12px] font-extrabold tracking-wide text-accent">
                    CHECKPOINT {cp.pct}% · {fmtVnShort(cp.sent_at as string, tz)}
                  </div>
                  <div className="mt-1 text-[16px] font-bold text-ink">{t.name}</div>
                  <div className="mt-1 text-[14.5px] text-ink-2">
                    Theo kế hoạch, đến lúc này cần xong <b>mốc {k}/4: {m?.label}</b>. Deadline {fmtVnShort(t.due_at, tz)}.
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="success" busy={busy === cp.id && d.mode === 'on_plan'} onClick={() => (d.mode === 'on_plan' ? answer(cp, 'on_plan') : set(cp.id, { mode: 'on_plan' }))}>
                      {ANSWER_LABEL.on_plan} (đã xong)
                    </Button>
                    <Button variant="secondary" busy={busy === cp.id && d.mode === 'behind'} onClick={() => answer(cp, 'behind')}>
                      {ANSWER_LABEL.behind}
                    </Button>
                    <Button variant="danger" onClick={() => set(cp.id, { mode: 'blocked' })}>
                      {ANSWER_LABEL.blocked}
                    </Button>
                  </div>
                  {d.mode === 'on_plan' && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <Field label="Link bằng chứng (không bắt buộc)" className="min-w-[260px] flex-1">
                        {(id) => <Input id={id} type="url" placeholder="https://drive.google.com/…" value={d.evidence} onChange={(e) => set(cp.id, { evidence: e.target.value })} />}
                      </Field>
                      <Button variant="success" busy={busy === cp.id} onClick={() => answer(cp, 'on_plan')}>
                        Xác nhận mốc {k} đã xong
                      </Button>
                    </div>
                  )}
                  {d.mode === 'blocked' && (
                    <div className="mt-3 flex flex-col gap-2">
                      <Field label="Vì sao bị chặn? (bắt buộc)">{(id) => <Textarea id={id} value={d.reason} onChange={(e) => set(cp.id, { reason: e.target.value })} />}</Field>
                      <div className="flex justify-end">
                        <Button variant="danger" busy={busy === cp.id} disabled={!d.reason.trim()} onClick={() => answer(cp, 'blocked')}>
                          Báo bị chặn
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <Card title="Task đang mở" subtitle="Bị chặn giữa hai checkpoint? Báo ngay, không cần đợi bot hỏi.">
        {!items.length ? (
          <p className="text-sm text-ink-3">Bạn không có task nào đang mở.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map(({ t, cps, ms, live }) => (
              <li key={t.id} className="rounded-xl border border-line-soft p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/tasks/${t.id}`} className="font-bold text-ink hover:text-brand">
                    {t.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    <TaskStatusBadge status={t.status} waiting={!!live} />
                    {t.status !== 'blocked' && (
                      <Button size="sm" variant="danger" onClick={() => setBlocker(t)}>
                        Báo bị chặn ngay
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <MilestonePills milestones={ms} checkpoints={cps} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <BlockerModal task={blocker} onClose={() => setBlocker(null)} onDone={reload} />
    </div>
  );
}
