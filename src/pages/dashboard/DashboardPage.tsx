import { ReactNode, useMemo, useState } from 'react';
import {
  BAND_LABEL,
  checkpointResponseRate,
  earlyWarningRate,
  fmtNum,
  localToMs,
  overdueRate,
  quoteKpis,
  turnaroundByBand,
  weeklyTurnaround,
} from '@/domain';
import { Banner, Button, Card, ErrorBox, Field, Icon, Input, Loading, PageHeader, Select, useAsync } from '@/components/ui';
import { downloadText, toCsv } from '@/lib/csv';
import { fmtVnDateTime, toDateInput } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { ALERT_COLS, AlertRow, CP_COLS, CheckpointRow, TASK_COLS, TaskRow } from '../tasks/data';
import { WeeklyChart } from './WeeklyChart';

interface QuoteLite {
  id: string;
  code: string;
  client: string;
  service_group: string | null;
  requested_at: string;
  sent_at: string;
  band_result: 'send_now' | 'pm' | 'ceo' | null;
  source: string;
}

function dayStart(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return localToMs(y, m, d, 0, 0, tz);
}

function Tile({ label, value, base, target, good, children }: { label: string; value: string; base?: string; target: string; good: boolean | null; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-canvas p-4">
      <div className="text-[13px] font-semibold text-ink-2">{label}</div>
      <div className="text-[32px] font-extrabold leading-tight text-ink">{value}</div>
      <div className="text-[13px] text-ink-3">
        {base && <>Baseline {base} · </>}Mục tiêu {target}
      </div>
      {good !== null && (
        <div className={`mt-1 inline-flex items-center gap-1 text-[13px] font-bold ${good ? 'text-ok-ink' : 'text-bad'}`}>
          <Icon name={good ? 'check' : 'x'} size={16} /> {good ? 'Đạt mục tiêu' : 'Chưa đạt'}
        </div>
      )}
      {children}
    </div>
  );
}

export function DashboardPage() {
  const me = useProfile();
  const { settings, calendar, tz } = useSettings();
  const seeQuotes = ['pm', 'ceo', 'admin'].includes(me.role);
  const seeTasks = ['ecom_exec', 'pm', 'ceo', 'admin'].includes(me.role);
  const defFrom = settings?.pilot_start ?? toDateInput(Date.now() - 27 * 86_400_000, tz);
  const defTo = settings?.pilot_end ?? toDateInput(Date.now(), tz);
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(defTo);
  const [source, setSource] = useState<'app' | 'import'>('app');
  const [table, setTable] = useState(false);
  const late = settings?.quote_late_hours ?? 8;
  const base = settings?.kpi_baselines ?? { quote_avg_hours: 8.66, quote_late_pct: 52.6, quote_count: 19, task_overdue_pct: 55.2 };
  const tgt = settings?.kpi_targets ?? { quote_avg_hours: 6.93, quote_late_pct: 30, response_rate: 90, early_warning: 85, overdue_pct: 20 };

  const range = useMemo(() => {
    const a = dayStart(from, tz);
    const b = dayStart(to, tz) + 86_400_000;
    return { a: new Date(a).toISOString(), b: new Date(b).toISOString(), ok: b > a };
  }, [from, to, tz]);

  const { data, error, loading } = useAsync(async () => {
    if (!range.ok) return null;
    const [quotes, tasks] = await Promise.all([
      seeQuotes
        ? supabase.from('quotes').select('id, code, client, service_group, requested_at, sent_at, band_result, source').eq('status', 'sent').eq('source', source).gte('sent_at', range.a).lt('sent_at', range.b).order('sent_at')
        : Promise.resolve({ data: [], error: null }),
      seeTasks ? supabase.from('tasks').select(TASK_COLS).gte('due_at', range.a).lt('due_at', range.b).neq('status', 'cancelled') : Promise.resolve({ data: [], error: null }),
    ]);
    const ts = check(tasks) as TaskRow[];
    const ids = ts.map((t) => t.id);
    const [cps, als, ppl] = await Promise.all([
      seeTasks ? supabase.from('checkpoints').select(CP_COLS).gte('sent_at', range.a).lt('sent_at', range.b) : Promise.resolve({ data: [], error: null }),
      ids.length ? supabase.from('alerts').select(ALERT_COLS).in('task_id', ids) : Promise.resolve({ data: [], error: null }),
      supabase.from('profiles').select('id, full_name, email'),
    ]);
    return {
      quotes: check(quotes) as QuoteLite[],
      tasks: ts,
      cps: check(cps) as CheckpointRow[],
      alerts: check(als) as AlertRow[],
      names: new Map((check(ppl) as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p.full_name || p.email])),
    };
  }, [range.a, range.b, source, seeQuotes, seeTasks]);

  const k = useMemo(() => {
    if (!data) return null;
    const qs = data.quotes.map((q) => ({ id: q.id, requestedAt: Date.parse(q.requested_at), sentAt: Date.parse(q.sent_at), bandResult: q.band_result }));
    const tasks = data.tasks.map((t) => ({ id: t.id, dueAt: Date.parse(t.due_at), closedAs: t.closed_as, status: t.status }));
    return {
      quote: quoteKpis(qs, calendar, late),
      weekly: weeklyTurnaround(qs, calendar, late),
      byBand: turnaroundByBand(qs, calendar, late),
      response: checkpointResponseRate(data.cps.map((c) => ({ id: c.id, taskId: c.task_id, sentAt: c.sent_at ? Date.parse(c.sent_at) : null, answeredAt: c.answered_at ? Date.parse(c.answered_at) : null }))),
      early: earlyWarningRate(tasks, data.alerts.map((a) => ({ taskId: a.task_id, kind: a.kind, createdAt: Date.parse(a.created_at) }))),
      overdue: overdueRate(tasks),
    };
  }, [data, calendar, late]);

  const fileTag = `${from}_${to}`;
  const exportQuotes = () =>
    k &&
    data &&
    downloadText(
      `kpi_bao_gia_${source}_${fileTag}.csv`,
      toCsv(
        k.quote.rows.map((r) => {
          const q = data.quotes.find((x) => x.id === r.id)!;
          return { code: q.code, client: q.client, service_group: q.service_group ?? '', requested_at: fmtVnDateTime(q.requested_at, tz), sent_at: fmtVnDateTime(q.sent_at, tz), working_hours: r.hours.toFixed(2), late: r.late ? 1 : 0, band_result: q.band_result ?? '' };
        }),
        ['code', 'client', 'service_group', 'requested_at', 'sent_at', 'working_hours', 'late', 'band_result'],
      ),
    );
  const exportCheckpoints = () =>
    data &&
    downloadText(
      `kpi_checkpoint_${fileTag}.csv`,
      toCsv(
        data.cps.map((c) => ({ task_id: c.task_id, pct: c.pct, scheduled_at: fmtVnDateTime(c.scheduled_at, tz), sent_at: c.sent_at ? fmtVnDateTime(c.sent_at, tz) : '', sent_via: c.sent_via ?? '', answered_at: c.answered_at ? fmtVnDateTime(c.answered_at, tz) : '', answer: c.answer ?? '', answer_via: c.answer_via ?? '', answered: c.answered_at ? 1 : 0 })),
        ['task_id', 'pct', 'scheduled_at', 'sent_at', 'sent_via', 'answered_at', 'answer', 'answer_via', 'answered'],
      ),
    );
  const exportTasks = () =>
    k &&
    data &&
    downloadText(
      `kpi_task_${fileTag}.csv`,
      toCsv(
        data.tasks.map((t) => {
          const ew = k.early.rows.find((r) => r.taskId === t.id);
          return {
            task_id: t.id,
            name: t.name,
            owner: data.names.get(t.owner_id) ?? '',
            due_at: fmtVnDateTime(t.due_at, tz),
            status: t.status,
            closed_as: t.closed_as ?? '',
            ever_risky: ew ? 1 : 0,
            first_alert_at: ew?.firstAlertAt ? fmtVnDateTime(ew.firstAlertAt, tz) : '',
            warned_early: ew?.early ? 1 : 0,
          };
        }),
        ['task_id', 'name', 'owner', 'due_at', 'status', 'closed_as', 'ever_risky', 'first_alert_at', 'warned_early'],
      ),
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Dashboard KPI" subtitle="Mọi con số tính tự động từ mốc thời gian đã lưu, bằng giờ làm việc, theo đúng định nghĩa trong PRD." />
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4">
        <Field label="Từ ngày">{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Đến ngày">{(id) => <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        {seeQuotes && (
          <Field label="Nguồn báo giá">
            {(id) => (
              <Select id={id} value={source} onChange={(e) => setSource(e.target.value as 'app' | 'import')}>
                <option value="app">Pilot (tạo trong app)</option>
                <option value="import">Lịch sử (import, để đối chiếu baseline)</option>
              </Select>
            )}
          </Field>
        )}
        <Button variant="ghost" onClick={() => { setFrom(defFrom); setTo(defTo); }}>
          Về khoảng pilot
        </Button>
      </div>
      <Banner tone="info">Mẫu nhỏ (khoảng 6 báo giá và 15 task mỗi tháng): kết quả 4 tuần chỉ mang tính chỉ báo. Trong báo cáo, gắn nhãn P/A cho kết luận rút ra từ đây.</Banner>
      {!range.ok ? (
        <Banner tone="warn">Ngày kết thúc phải sau ngày bắt đầu.</Banner>
      ) : loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        k && (
          <>
            {seeTasks && (
              <Card
                title="Task e-commerce (S1)"
                subtitle={`${data!.tasks.length} task có deadline trong khoảng · ${k.response.sent} checkpoint đã gửi`}
                actions={
                  <>
                    <Button size="sm" variant="secondary" icon="download" onClick={exportCheckpoints}>
                      CSV checkpoint
                    </Button>
                    <Button size="sm" variant="secondary" icon="download" onClick={exportTasks}>
                      CSV task
                    </Button>
                  </>
                }
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <Tile
                    label="Tỷ lệ task trễ hạn"
                    value={k.overdue.rate === null ? '–' : `${fmtNum(k.overdue.rate, 1)}%`}
                    base={`${fmtNum(base.task_overdue_pct, 1)}%`}
                    target={`< ${fmtNum(tgt.overdue_pct, 0)}%`}
                    good={k.overdue.rate === null ? null : k.overdue.rate < tgt.overdue_pct}
                  >
                    <div className="text-[13px] text-ink-3">
                      {k.overdue.overdue}/{k.overdue.closed} task đã chốt
                    </div>
                  </Tile>
                  <Tile
                    label="Tỷ lệ trả lời checkpoint"
                    value={k.response.rate === null ? '–' : `${fmtNum(k.response.rate, 1)}%`}
                    target={`≥ ${fmtNum(tgt.response_rate, 0)}%`}
                    good={k.response.rate === null ? null : k.response.rate >= tgt.response_rate}
                  >
                    <div className="text-[13px] text-ink-3">
                      {k.response.answered}/{k.response.sent} checkpoint
                    </div>
                  </Tile>
                  <Tile
                    label="Tỷ lệ rủi ro được cảnh báo sớm"
                    value={k.early.rate === null ? '–' : `${fmtNum(k.early.rate, 1)}%`}
                    target={`≥ ${fmtNum(tgt.early_warning, 0)}%`}
                    good={k.early.rate === null ? null : k.early.rate >= tgt.early_warning}
                  >
                    <div className="text-[13px] text-ink-3">
                      {k.early.early}/{k.early.risky} task có rủi ro được báo trước deadline
                    </div>
                  </Tile>
                </div>
              </Card>
            )}
            {seeQuotes && (
              <Card
                title="Báo giá (S2)"
                subtitle={`${k.quote.count} báo giá gửi trong khoảng đã chọn · thời gian = giờ làm việc từ lúc khách yêu cầu đến lúc gửi`}
                actions={
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setTable((v) => !v)}>
                      {table ? 'Xem biểu đồ' : 'Xem bảng'}
                    </Button>
                    <Button size="sm" variant="secondary" icon="download" onClick={exportQuotes}>
                      Xuất CSV
                    </Button>
                  </>
                }
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <Tile
                    label={`Tỷ lệ báo giá quá ${late} giờ`}
                    value={k.quote.latePct === null ? '–' : `${fmtNum(k.quote.latePct, 1)}%`}
                    base={`${fmtNum(base.quote_late_pct, 1)}%`}
                    target={`≤ ${fmtNum(tgt.quote_late_pct, 0)}%`}
                    good={k.quote.latePct === null ? null : k.quote.latePct <= tgt.quote_late_pct}
                  >
                    <div className="text-[13px] text-ink-3">
                      {k.quote.lateCount}/{k.quote.count} báo giá
                    </div>
                  </Tile>
                  <Tile
                    label="Thời gian báo giá trung bình"
                    value={k.quote.avgHours === null ? '–' : `${fmtNum(k.quote.avgHours, 2)} h`}
                    base={`${fmtNum(base.quote_avg_hours, 2)} h`}
                    target={`≤ ${fmtNum(tgt.quote_avg_hours, 2)} h`}
                    good={k.quote.avgHours === null ? null : k.quote.avgHours <= tgt.quote_avg_hours}
                  />
                  <div className="rounded-xl bg-canvas p-4">
                    <div className="text-[13px] font-semibold text-ink-2">Theo kết quả khung giá</div>
                    <ul className="mt-2 flex flex-col gap-1.5 text-[14px]">
                      {k.byBand.map((b) => (
                        <li key={b.level} className="flex justify-between gap-2">
                          <span>{BAND_LABEL[b.level]}</span>
                          <span className="tabular-nums">
                            {b.count} · {b.avgHours === null ? '–' : `${fmtNum(b.avgHours, 2)} h`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {source === 'import' && <p className="mt-2 text-[12px] text-ink-3">Dữ liệu lịch sử không có kết quả khung giá.</p>}
                  </div>
                </div>
                <h3 className="mt-5 text-[15px] font-bold text-ink">Thời gian báo giá trung bình theo tuần (giờ làm việc)</h3>
                {!k.weekly.length ? (
                  <p className="mt-2 text-sm text-ink-3">Chưa có báo giá nào được gửi trong khoảng này.</p>
                ) : table ? (
                  <table className="mt-2 w-full max-w-xl text-[14px]">
                    <thead className="text-left text-[13px] text-ink-3">
                      <tr className="border-b border-line">
                        <th className="py-1.5">Tuần bắt đầu</th>
                        <th className="py-1.5 text-right">Số báo giá</th>
                        <th className="py-1.5 text-right">TB giờ</th>
                        <th className="py-1.5 text-right">% quá {late}h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {k.weekly.map((w) => (
                        <tr key={w.weekStart} className="border-b border-line-soft">
                          <td className="py-1.5">{w.weekStart.split('-').reverse().join('/')}</td>
                          <td className="py-1.5 text-right tabular-nums">{w.count}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmtNum(w.avgHours, 2)}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmtNum(w.latePct, 0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <WeeklyChart points={k.weekly} baseline={base.quote_avg_hours} target={tgt.quote_avg_hours} lateHours={late} />
                )}
              </Card>
            )}
          </>
        )
      )}
    </div>
  );
}
