import { useEffect, useMemo, useState } from 'react';
import {
  daysUntil,
  draftPreviewMessage,
  DraftContext,
  fmtDueDate,
  LARK_HELP_TEXT,
  larkLateStats,
  LarkDraft,
  milestoneFor,
  normalizeCode,
  parentCodeOf,
  validateDraft,
  localDateKey,
} from '@/domain';
import { Badge, Banner, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Textarea, cx, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtPct, timeAgo } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { BotCard } from './BotCard';
import { LARK_NOTIF_COLS, LARK_TASK_COLS, LarkNotificationRow, LarkPerson, LarkTaskRow, rulesOf } from './data';

const MANAGERS = ['admin', 'ecom_exec', 'pm', 'ceo'];
type Tab = 'track' | 'group' | 'create';

export function LarkPage() {
  const me = useProfile();
  const { settings, tz, reload: reloadSettings } = useSettings();
  const toast = useToast();
  const mode = settings?.lark_mode ?? 'simulation';
  const [tab, setTab] = useState<Tab>('track');
  const [running, setRunning] = useState(false);
  const [sim, setSim] = useState<LarkTaskRow | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    if (mode === 'simulation') await callApi('lark.people').catch(() => null);
    const [tasks, notifs, people] = await Promise.all([
      supabase.from('lark_tasks').select(LARK_TASK_COLS).is('deleted_at', null).order('due_date'),
      supabase.from('lark_notifications').select(LARK_NOTIF_COLS).order('created_at', { ascending: false }).limit(300),
      supabase.from('lark_people').select('open_id, name, profile_id').order('name'),
    ]);
    return {
      tasks: (check(tasks) as LarkTaskRow[]).map((t) => ({ ...t, code_errors: Array.isArray(t.code_errors) ? t.code_errors : [] })),
      notifs: check(notifs) as LarkNotificationRow[],
      people: check(people) as LarkPerson[],
    };
  }, [mode]);

  const isManager = MANAGERS.includes(me.role);
  const status = (settings?.lark_status ?? {}) as { at?: string; reminders?: number; completions?: number; failed?: number; note?: string; synced?: number; syncErrors?: number };

  async function runNow() {
    setRunning(true);
    try {
      const r = await callApi<{ reminders: number; completions: number; failed: number; note?: string }>('lark.run');
      toast(r.note ?? `Đã kiểm tra: ${r.reminders} nhắc việc, ${r.completions} xác nhận hoàn thành${r.failed ? `, ${r.failed} lỗi gửi (sẽ thử lại)` : ''}.`, r.failed ? 'bad' : 'ok');
      await Promise.all([reload(), reloadSettings()]);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setRunning(false);
    }
  }

  const children = (data?.tasks ?? []).filter((t) => t.kind === 'child');
  const stats = larkLateStats(
    children.map((c) => ({ dueDate: c.due_date, completedAt: c.completed_at && !c.code_errors.length ? Date.parse(c.completed_at) : null })),
    Date.now(),
    tz,
  );

  return (
    <div>
      <PageHeader
        title="S1 · Nhắc task trên Lark"
        subtitle={`Bot nhắc trong group Lark lúc ${settings?.lark_notify_time ?? '09:00'} mỗi ngày: D-3, D-2, D-1${settings?.lark_notify_d0 ? ', D0' : ''} và từ D+1 đến khi task con Completed với mã hợp lệ.`}
        actions={
          isManager && (
            <Button icon="refresh" busy={running} onClick={runNow}>
              Chạy kiểm tra ngay
            </Button>
          )
        }
      />
      {mode === 'live' && (
        <Banner tone="ok" title="Đang kết nối Lark" className="mb-4">
          Task tạo qua bot hoặc ở đây được lưu trên Lark Tasks; hệ thống đồng bộ mỗi 15 phút.
        </Banner>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Task con đang theo dõi" value={children.filter((c) => !c.closed_at).length} />
        <Stat label="Sắp đến hạn (≤ 3 ngày)" value={children.filter((c) => !c.completed_at && daysUntil(c.due_date, Date.now(), tz) >= 0 && daysUntil(c.due_date, Date.now(), tz) <= 3).length} />
        <Stat label="Đang quá hạn" value={stats.openLate} tone={stats.openLate ? 'bad' : null} />
        <Stat label="Đã hoàn thành" value={stats.onTime + stats.late} sub={`${stats.onTime} đúng hạn · ${stats.late} trễ`} />
        <Stat label="Tỷ lệ trễ (M1)" value={fmtPct(stats.latePct)} sub="Mục tiêu < 20%" tone={stats.latePct === null ? null : stats.latePct < 20 ? 'ok' : 'bad'} />
      </div>
      {status.at && (
        <p className="mb-3 text-[13px] text-ink-3">
          Lần kiểm tra gần nhất {timeAgo(status.at)}: {status.reminders ?? 0} nhắc việc, {status.completions ?? 0} xác nhận hoàn thành
          {status.failed ? `, ${status.failed} lỗi gửi` : ''}
          {status.syncErrors ? `, ${status.syncErrors} lỗi đồng bộ` : ''}
          {status.note ? ` · ${status.note}` : ''}.
        </p>
      )}

      <div role="tablist" aria-label="S1 Lark" className="mb-5 flex gap-6 border-b border-line">
        {(
          [
            ['track', 'Theo dõi task'],
            ['group', 'Group Lark'],
            ['create', 'Tạo task'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx('-mb-px min-h-[42px] border-b-2 px-0.5 text-[14.5px] transition-colors duration-150', tab === k ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-3 hover:border-line hover:text-ink')}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : tab === 'track' ? (
        <TrackTab data={data!} tz={tz} canSimulate={mode === 'simulation'} me={me} onSimulate={setSim} />
      ) : tab === 'group' ? (
        <GroupTab notifs={data!.notifs} tasks={data!.tasks} />
      ) : (
        <CreateTab
          data={data!}
          tz={tz}
          onCreated={() => {
            reload();
            setTab('track');
          }}
        />
      )}
      {sim && data && <SimulateModal task={sim} people={data.people} onClose={() => setSim(null)} onDone={() => reload()} />}
    </div>
  );
}

function statusOf(t: LarkTaskRow, tz: string): { text: string; tone: 'ok' | 'bad' | 'warn' | 'brand' | 'neutral' } {
  if (t.closed_at) return { text: 'Hoàn thành', tone: 'ok' };
  if (t.completed_at && t.code_errors.length) return { text: 'Completed · mã sai', tone: 'bad' };
  if (t.completed_at) return { text: 'Completed · chờ xác nhận', tone: 'brand' };
  const d = daysUntil(t.due_date, Date.now(), tz);
  if (d < 0) return { text: `Quá hạn ${-d} ngày`, tone: 'bad' };
  if (d === 0) return { text: 'Đến hạn hôm nay', tone: 'warn' };
  if (d <= 3) return { text: `Còn ${d} ngày`, tone: 'warn' };
  return { text: `Còn ${d} ngày`, tone: 'neutral' };
}

function TrackTab({
  data,
  tz,
  canSimulate,
  me,
  onSimulate,
}: {
  data: { tasks: LarkTaskRow[]; notifs: LarkNotificationRow[] };
  tz: string;
  canSimulate: boolean;
  me: { id: string; role: string };
  onSimulate: (t: LarkTaskRow) => void;
}) {
  const parents = data.tasks.filter((t) => t.kind === 'parent');
  const lastNotif = useMemo(() => {
    const m = new Map<string, LarkNotificationRow>();
    for (const n of data.notifs) if (!m.has(n.task_id)) m.set(n.task_id, n);
    return m;
  }, [data.notifs]);
  if (!parents.length) return <EmptyState title="Chưa có task nào">Tạo task mẹ ở tab “Tạo task” hoặc nhắn lệnh /taomoi cho bot trên Lark.</EmptyState>;
  return (
    <div className="flex flex-col gap-4">
      {parents.map((p) => {
        const kids = data.tasks.filter((t) => t.parent_id === p.id);
        return (
          <Card
            key={p.id}
            title={
              <span>
                <span className="mr-2 font-mono text-[14px] text-brand">{p.code}</span>
                {p.name}
              </span>
            }
            subtitle={`Phụ trách: ${p.assignee_name ?? '—'} · Deadline tổng ${fmtDueDate(p.due_date)} · ${kids.length} task con${p.mode === 'live' ? ' · trên Lark' : ''}`}
            actions={p.lark_url ? <a className="text-[13px] font-bold text-brand underline" href={p.lark_url} target="_blank" rel="noreferrer">Mở trên Lark</a> : undefined}
          >
            {!kids.length ? (
              <p className="text-ink-3">Chưa có task con.</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[720px] text-[14.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[12.5px] text-ink-3">
                      <th className="py-2 pr-3">Mã</th>
                      <th className="py-2 pr-3">Task con</th>
                      <th className="py-2 pr-3">Người thực hiện</th>
                      <th className="py-2 pr-3">Deadline</th>
                      <th className="py-2 pr-3">Trạng thái</th>
                      <th className="py-2 pr-3">Nhắc gần nhất</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {kids.map((k) => {
                      const st = statusOf(k, tz);
                      const d = daysUntil(k.due_date, Date.now(), tz);
                      const next = !k.closed_at ? milestoneFor(d) : null;
                      const last = lastNotif.get(k.id);
                      const own = k.assignee_open_id === `sim:${me.id}`;
                      return (
                        <tr key={k.id} className="border-b border-line-soft align-top">
                          <td className="py-2.5 pr-3 font-mono text-[13.5px]">
                            {k.code}
                            {k.code_errors.length > 0 && <div className="mt-0.5 max-w-[220px] font-sans text-[12px] text-bad">{k.code_errors[0]}</div>}
                          </td>
                          <td className="py-2.5 pr-3">
                            {k.name}
                            {k.description && <div className="text-[12.5px] text-ink-3">{k.description}</div>}
                          </td>
                          <td className="py-2.5 pr-3">{k.assignee_name ?? '—'}</td>
                          <td className="whitespace-nowrap py-2.5 pr-3">{fmtDueDate(k.due_date)}</td>
                          <td className="py-2.5 pr-3">
                            <Badge tone={st.tone}>{st.text}</Badge>
                            {next && !k.completed_at && <div className="mt-1 text-[12px] text-ink-3">Hôm nay: {next.label}</div>}
                          </td>
                          <td className="py-2.5 pr-3 text-[13px] text-ink-2">
                            {last ? (
                              <>
                                {last.kind === 'completion' ? 'Xác nhận xong' : last.milestone} · {fmtDueDate(last.local_date)}
                                {last.status === 'failed' && <div className="text-bad">Lỗi gửi (lần {last.attempts})</div>}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2 text-right">
                            {k.mode === 'live' && k.lark_url ? (
                              <a className="text-[13px] font-bold text-brand underline" href={k.lark_url} target="_blank" rel="noreferrer">
                                Lark
                              </a>
                            ) : canSimulate && k.mode === 'simulation' && (own || MANAGERS.includes(me.role)) ? (
                              <Button size="sm" variant="secondary" onClick={() => onSimulate(k)}>
                                Cập nhật
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function GroupTab({ notifs, tasks }: { notifs: LarkNotificationRow[]; tasks: LarkTaskRow[] }) {
  const [onlyFailed, setOnlyFailed] = useState(false);
  const list = onlyFailed ? notifs.filter((n) => n.status === 'failed') : notifs;
  const days = [...new Set(list.map((n) => n.local_date))];
  if (!notifs.length) return <EmptyState title="Chưa có tin nhắn nào">Tin nhắc được gửi từ {`09:00`} khi có task con ở mốc D-3, D-2, D-1 hoặc đã quá hạn. Quản lý có thể bấm “Chạy kiểm tra ngay”.</EmptyState>;
  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-[14px] text-ink-2">
        <input type="checkbox" className="h-4 w-4" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} /> Chỉ tin gửi lỗi
      </label>
      {days.map((d) => (
        <section key={d} className="mb-5">
          <h2 className="mb-2 text-[13px] font-semibold text-ink-3">{fmtDueDate(d)}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list
              .filter((n) => n.local_date === d)
              .map((n) => {
                const t = tasks.find((x) => x.id === n.task_id);
                return (
                  <div key={n.id}>
                    <BotCard message={n.message} time={n.sent_at ? new Date(n.sent_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : undefined} />
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[12px] text-ink-3">
                      {n.status === 'sent' ? <Badge tone="ok">Đã gửi lên Lark</Badge> : n.status === 'failed' ? <Badge tone="bad">Lỗi gửi · lần {n.attempts}</Badge> : null}
                      {t && <span className="font-mono">{t.code}</span>}
                      {n.last_error && n.status === 'failed' && <span className="text-bad">{n.last_error}</span>}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

function CreateTab({ data, tz, onCreated }: { data: { tasks: LarkTaskRow[]; people: LarkPerson[] }; tz: string; onCreated: () => void }) {
  const { settings } = useSettings();
  const toast = useToast();
  const rules = rulesOf(settings);
  const parents = data.tasks.filter((t) => t.kind === 'parent' && !t.closed_at);
  const [kind, setKind] = useState<'parent' | 'child'>(parents.length ? 'child' : 'parent');
  const [parentId, setParentId] = useState(parents[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [who, setWho] = useState('');
  const [due, setDue] = useState('');
  const [desc, setDesc] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const parent = parents.find((p) => p.id === parentId);

  useEffect(() => {
    if (kind === 'child' && parent && !code) setCode(`${parent.code}-`);
  }, [kind, parent, code]);

  const draft: LarkDraft = {
    kind,
    code: normalizeCode(code),
    name,
    assigneeOpenId: who || null,
    assigneeName: data.people.find((p) => p.open_id === who)?.name ?? null,
    dueDate: due || null,
    description: desc || null,
    parentCode: kind === 'child' ? parent?.code ?? parentCodeOf(normalizeCode(code), rules) : null,
  };
  const dctx: DraftContext = {
    rules,
    now: Date.now(),
    timeZone: tz,
    existingCodes: new Set(data.tasks.map((t) => normalizeCode(t.code))),
    parents: new Map(data.tasks.filter((t) => t.kind === 'parent').map((t) => [normalizeCode(t.code), { dueDate: t.due_date }])),
  };
  const errors = validateDraft(draft, dctx);

  async function create() {
    setBusy(true);
    try {
      await callApi('lark.create', {
        kind,
        code: draft.code,
        name,
        assignee_open_id: who,
        due_date: due,
        description: desc,
        parent_code: draft.parentCode,
      });
      toast(kind === 'parent' ? `Đã tạo task mẹ ${draft.code}` : `Đã tạo task con ${draft.code}`);
      setCode('');
      setName('');
      setDesc('');
      setPreview(false);
      onCreated();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Card title="Tạo task (giống lệnh bot)" subtitle={`Mã task mẹ dạng ${rules.parentExample}, task con dạng ${rules.childExample}. Mã sai thì không tạo.`}>
        <div className="mb-3 flex gap-2">
          {(['parent', 'child'] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                setCode('');
                setPreview(false);
              }}
              aria-pressed={kind === k}
              className={cx('min-h-[40px] rounded-lg border px-3 text-[14px] font-bold', kind === k ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-2')}
            >
              {k === 'parent' ? 'Task mẹ' : 'Task con'}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === 'child' && (
            <Field label="Task mẹ liên kết" className="sm:col-span-2">
              {(id) => (
                <Select
                  id={id}
                  value={parentId}
                  onChange={(e) => {
                    setParentId(e.target.value);
                    setCode('');
                  }}
                >
                  {!parents.length && <option value="">Chưa có task mẹ</option>}
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label={kind === 'parent' ? 'Mã task mẹ' : 'Mã task con'}>
            {(id) => <Input id={id} value={code} placeholder={kind === 'parent' ? rules.parentExample : rules.childExample} onChange={(e) => setCode(e.target.value)} className="font-mono uppercase" />}
          </Field>
          <Field label={kind === 'parent' ? 'Deadline tổng' : 'Deadline'}>{(id) => <Input id={id} type="date" value={due} min={localDateKey(Date.now(), tz)} onChange={(e) => setDue(e.target.value)} />}</Field>
          <Field label={kind === 'parent' ? 'Tên task mẹ' : 'Tên task con'} className="sm:col-span-2">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: [STING] Push 50 KOC gửi đủ số lượng video" />}
          </Field>
          <Field label={kind === 'parent' ? 'Người phụ trách' : 'Người thực hiện'} hint="Người được @tag trong group Lark">
            {(id) => (
              <Select id={id} value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">— Chọn —</option>
                {data.people.map((p) => (
                  <option key={p.open_id} value={p.open_id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {kind === 'child' && <Field label="Mô tả (không bắt buộc)">{(id) => <Textarea id={id} value={desc} onChange={(e) => setDesc(e.target.value)} className="min-h-[44px]" />}</Field>}
        </div>
        {(code || name || due) && errors.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-[13.5px] text-bad">
            {errors.map((e) => (
              <li key={e}>❌ {e}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <Button disabled={errors.length > 0} onClick={() => setPreview(true)}>
            Xem trước
          </Button>
          {preview && !errors.length && (
            <Button variant="accent" busy={busy} onClick={create}>
              Xác nhận tạo
            </Button>
          )}
        </div>
      </Card>
      <div className="flex flex-col gap-3">
        {preview && !errors.length ? (
          <BotCard message={{ ...draftPreviewMessage(draft, 'web', parent?.name), buttons: undefined, note: 'Kiểm tra lại rồi bấm “Xác nhận tạo”.' }} />
        ) : (
          <Card title="Trên Lark, nhân viên nhắn cho bot">
            <pre className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{LARK_HELP_TEXT}</pre>
          </Card>
        )}
      </div>
    </div>
  );
}

function SimulateModal({ task, people, onClose, onDone }: { task: LarkTaskRow; people: LarkPerson[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [due, setDue] = useState(task.due_date);
  const [who, setWho] = useState(task.assignee_open_id ?? '');
  const [code, setCode] = useState(task.code);
  const [busy, setBusy] = useState<string | null>(null);
  async function act(op: string, extra: Record<string, unknown> = {}, ok = 'Đã cập nhật') {
    setBusy(op);
    try {
      await callApi('lark.simulate', { task_id: task.id, op, ...extra });
      toast(ok);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Cập nhật task · ${task.code}`}>
      <p className="mb-3 text-[14px] text-ink-2">Cập nhật trạng thái, deadline, người thực hiện hoặc mã của task. Lần kiểm tra kế tiếp (hoặc “Chạy kiểm tra ngay”) sẽ dùng dữ liệu mới.</p>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {task.completed_at ? (
            <Button variant="secondary" busy={busy === 'reopen'} onClick={() => act('reopen', {}, 'Đã mở lại task')}>
              Bỏ Completed
            </Button>
          ) : (
            <Button variant="accent" icon="check" busy={busy === 'complete'} onClick={() => act('complete', {}, 'Task được đánh dấu Completed')}>
              Đánh dấu Completed
            </Button>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Field label="Đổi deadline" className="flex-1">
            {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
          </Field>
          <Button variant="secondary" busy={busy === 'set_due'} disabled={due === task.due_date} onClick={() => act('set_due', { due_date: due })}>
            Lưu
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Đổi người thực hiện" className="flex-1">
            {(id) => (
              <Select id={id} value={who} onChange={(e) => setWho(e.target.value)}>
                {people.map((p) => (
                  <option key={p.open_id} value={p.open_id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="secondary" busy={busy === 'set_assignee'} disabled={who === task.assignee_open_id} onClick={() => act('set_assignee', { open_id: who })}>
            Lưu
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Sửa mã trên tiêu đề" className="flex-1">
            {(id) => <Input id={id} value={code} className="font-mono" onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Button variant="secondary" busy={busy === 'set_code'} disabled={code === task.code} onClick={() => act('set_code', { code })}>
            Lưu
          </Button>
        </div>
      </div>
    </Modal>
  );
}
