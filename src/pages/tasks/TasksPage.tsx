import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtNum, riskRank, validateTaskRows, workingHoursBetween } from '@/domain';
import { Badge, Banner, Button, Card, EmptyState, ErrorBox, Loading, Modal, PageHeader, Select, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { downloadText, parseCsv, readFileText, toCsv } from '@/lib/csv';
import { fmtVnLong, fmtVnShort } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { liveCheckpoint, loadOwners, loadTasks, loadTypes, TaskRow } from './data';
import { BlockerModal, emptyTask, MilestonePills, TaskFormModal, TaskStatusBadge } from './parts';

export function TasksPage() {
  const me = useProfile();
  const { calendar, tz } = useSettings();
  const manager = me.role === 'ecom_exec' || me.role === 'admin';
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [blocker, setBlocker] = useState<TaskRow | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const [bundle, owners, types] = await Promise.all([
      loadTasks({ ownerId: manager ? undefined : me.id, open: scope === 'open', withAlerts: manager }),
      manager ? loadOwners() : Promise.resolve([]),
      manager ? loadTypes() : Promise.resolve([]),
    ]);
    return { ...bundle, owners, types };
  }, [scope, me.id]);

  const now = Date.now();
  const rows = useMemo(() => {
    if (!data) return [];
    return data.tasks
      .filter((t) => !ownerFilter || t.owner_id === ownerFilter)
      .map((t) => {
        const cps = data.checkpoints.filter((c) => c.task_id === t.id);
        return { t, cps, ms: data.milestones.filter((m) => m.task_id === t.id), live: liveCheckpoint(cps), openAlerts: data.alerts.filter((a) => a.task_id === t.id && !a.acknowledged_at).length };
      })
      .sort((a, b) => riskRank(a.t.status) - riskRank(b.t.status) || Number(!!b.live) - Number(!!a.live) || Date.parse(a.t.due_at) - Date.parse(b.t.due_at));
  }, [data, ownerFilter]);

  const ownerName = (id: string) => {
    const o = data?.owners.find((x) => x.id === id);
    return o ? o.full_name || o.email : id === me.id ? me.full_name || me.email : '–';
  };

  return (
    <div>
      <PageHeader
        title={manager ? 'Task e-commerce' : 'Task của tôi'}
        subtitle={manager ? 'Sắp theo rủi ro: bị chặn, không cập nhật, có rủi ro lên trước. Mỗi task có 4 mốc kiểm chứng; bot hỏi ở 25/50/75/99% thời gian làm việc.' : 'Các task bạn phụ trách. Bị chặn bất cứ lúc nào thì báo ngay, không cần đợi checkpoint.'}
        actions={
          manager && (
            <>
              <Button variant="secondary" icon="upload" onClick={() => setImportOpen(true)}>
                Nhập CSV
              </Button>
              <Button icon="plus" onClick={() => setFormOpen(true)}>
                Tạo task
              </Button>
            </>
          )
        }
      />
      <Card
        title={`${rows.length} task`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Phạm vi" value={scope} onChange={(e) => setScope(e.target.value as 'open' | 'all')} className="w-44">
              <option value="open">Đang mở</option>
              <option value="all">Tất cả</option>
            </Select>
            {manager && (
              <Select aria-label="Người phụ trách" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className="w-52">
                <option value="">Mọi người</option>
                {data?.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.full_name || o.email}
                  </option>
                ))}
              </Select>
            )}
          </div>
        }
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !rows.length ? (
          <EmptyState title="Không có task nào">{manager ? 'Tạo task mới hoặc nhập từ Google Sheet (CSV).' : 'Khi được giao task, nó sẽ hiện ở đây.'}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map(({ t, cps, ms, live, openAlerts }) => {
              const left = workingHoursBetween(now, t.due_at, calendar);
              const next = cps.find((c) => !c.sent_at && !c.expired_at);
              const open = !t.closed_as && t.status !== 'cancelled';
              return (
                <li key={t.id} className="rounded-xl border border-line-soft p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/tasks/${t.id}`} className="text-[15.5px] font-bold text-ink hover:text-brand">
                        {t.name}
                      </Link>
                      <div className="text-[13px] text-ink-3">
                        {manager && <>Phụ trách: {ownerName(t.owner_id)} · </>}Deadline {fmtVnShort(t.due_at, tz)}
                        {open && left > 0 && ` · còn ${fmtNum(left, 1)} giờ làm việc`}
                        {next && open && ` · checkpoint tới ${fmtVnShort(next.scheduled_at, tz)}`}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {openAlerts > 0 && <Badge tone="bad">{openAlerts} cảnh báo chưa xử lý</Badge>}
                      {t.closed_as && <Badge tone={t.closed_as === 'on_time' ? 'ok' : 'bad'}>{t.closed_as === 'on_time' ? 'Đúng hạn' : 'Trễ hạn'}</Badge>}
                      <TaskStatusBadge status={t.status} waiting={!!live} />
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <MilestonePills milestones={ms} checkpoints={cps} now={now} />
                  </div>
                  {!manager && open && t.owner_id === me.id && (
                    <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                      {live && (
                        <Link to="/checkins" className="inline-flex min-h-[40px] items-center rounded-[10px] bg-brand px-3 text-sm font-semibold text-white">
                          Trả lời checkpoint {live.pct}%
                        </Link>
                      )}
                      {t.status !== 'blocked' && (
                        <Button size="sm" variant="danger" onClick={() => setBlocker(t)}>
                          Báo bị chặn ngay
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {manager && data && <TaskFormModal open={formOpen} onClose={() => setFormOpen(false)} initial={emptyTask()} owners={data.owners} types={data.types} onSaved={reload} />}
      {manager && <TaskImport open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />}
      <BlockerModal task={blocker} onClose={() => setBlocker(null)} onDone={reload} />
    </div>
  );
}

function TaskImport({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { tz } = useSettings();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [preview, setPreview] = useState<{ valid: number; errors: { row: number; message: string }[] } | null>(null);
  const [sample, setSample] = useState<{ name: string; startAt: number; dueAt: number }[]>([]);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const parsed = parseCsv(await readFileText(f)).rows;
      const local = validateTaskRows(parsed, tz);
      setRows(parsed);
      setSample(local.rows.slice(0, 3).map((r) => ({ name: r.name, startAt: r.startAt, dueAt: r.dueAt })));
      const r = await callApi<{ preview: { valid: number; errors: { row: number; message: string }[] } }>('task.import', { rows: parsed, dryRun: true });
      setPreview({ valid: r.preview.valid, errors: r.preview.errors.length ? r.preview.errors : local.errors });
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await callApi<{ created: number }>('task.import', { rows });
      toast(`Đã tạo ${r.created} task, mỗi task có 4 checkpoint`);
      setRows(null);
      setPreview(null);
      onClose();
      onDone();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const template = () =>
    downloadText(
      'mau_task.csv',
      toCsv(
        [{ task_name: 'Banner gian hàng Shopee', owner_email: 'thuctap1@gomedia.vn', task_type: 'Banner chiến dịch', start_at: '2026-11-09 08:00', due_at: '2026-11-13 17:30', priority_note: 'Xin ảnh sản phẩm từ khách' }],
        ['task_name', 'owner_email', 'task_type', 'start_at', 'due_at', 'priority_note'],
      ),
    );

  return (
    <Modal
      open={open}
      wide
      onClose={() => {
        setRows(null);
        setPreview(null);
        setSample([]);
        onClose();
      }}
      title="Nhập task từ CSV (Google Sheet)"
      footer={
        <>
          <Button variant="ghost" icon="download" onClick={template}>
            Tải file mẫu
          </Button>
          <Button busy={busy} disabled={!preview?.valid} onClick={run}>
            Tạo {preview?.valid ?? 0} task
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">
        Cột: <code>task_name, owner_email, task_type, start_at, due_at</code>; thêm <code>milestone_1..milestone_4</code> nếu task không theo loại chuẩn, <code>priority_note</code> nếu cần. Ngày giờ theo giờ Việt Nam, nên ghi dạng <code>2026-11-09 08:00</code>; dạng <code>09/11/2026 08:00</code> được hiểu là ngày/tháng/năm. Chỉ nhập task còn hạn: task đã qua deadline sẽ bị từ chối. Trong Google Sheet: Tệp → Tải xuống → CSV.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block min-h-[44px] w-full text-sm" />
      {busy && !preview && <Loading label="Đang kiểm tra file…" />}
      {preview && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <Badge tone="ok">{preview.valid} task hợp lệ</Badge>
            <Badge tone={preview.errors.length ? 'bad' : 'neutral'}>{preview.errors.length} dòng lỗi</Badge>
          </div>
          {sample.length > 0 && (
            <div className="rounded-lg border border-line-soft bg-canvas px-3 py-2 text-[13.5px] text-ink-2">
              <b>App đọc ngày như sau</b> (kiểm tra ngày/tháng không bị đảo):
              <ul className="mt-1 list-disc pl-5">
                {sample.map((r) => (
                  <li key={`${r.name}-${r.startAt}`}>
                    {r.name}: bắt đầu {fmtVnLong(r.startAt, tz)} · deadline {fmtVnLong(r.dueAt, tz)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.errors.length > 0 && (
            <Banner tone="warn" title="Các dòng lỗi sẽ bị bỏ qua">
              <ul className="list-disc pl-5">
                {preview.errors.slice(0, 30).map((e) => (
                  <li key={`${e.row}${e.message}`}>
                    Dòng {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </Banner>
          )}
        </div>
      )}
    </Modal>
  );
}
