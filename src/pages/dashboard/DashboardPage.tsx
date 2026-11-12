import { useEffect, useMemo, useState } from 'react';
import { fmtNum, larkDueStatus, larkPeriodKpis, localToMs, quoteKpis, turnaroundByBand, weeklyTurnaround } from '@/domain';
import { Banner, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, useAsync } from '@/components/ui';
import { downloadText, toCsv } from '@/lib/csv';
import { fmtVnDateTime, toDateInput } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { LARK_TASK_COLS, LarkTaskRow } from '../lark/data';
import { WeeklyChart } from './WeeklyChart';
import { DEFAULT_BASE, DEFAULT_TARGET, KpiTile, QuoteKpiTiles } from '../quotes/QuoteKpiTiles';

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

interface LarkNotifLite {
  task_id: string;
  local_date: string;
  kind: 'reminder' | 'completion';
  milestone: string | null;
  status: 'sent' | 'simulated' | 'failed';
  sent_at: string | null;
}

const DUE_LABEL = { on_time: 'đúng hạn', late: 'xong trễ', overdue: 'quá hạn chưa xong', open: 'chưa đến hạn' } as const;

/** A sub-task counts as done only when Completed with valid codes (same rule as the Lark page and the bot). */
const larkDone = (t: LarkTaskRow) => (t.completed_at && !t.code_errors.length ? Date.parse(t.completed_at) : null);

function dayStart(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return localToMs(y, m, d, 0, 0, tz);
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
  // Settings can arrive after the first render: follow the pilot period until the user picks dates.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return;
    setFrom(defFrom);
    setTo(defTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defFrom, defTo]);
  const [source, setSource] = useState<'app' | 'import'>('app');
  const [table, setTable] = useState(false);
  const late = settings?.quote_late_hours ?? 8;
  const base = settings?.kpi_baselines ?? DEFAULT_BASE;
  const tgt = settings?.kpi_targets ?? DEFAULT_TARGET;

  const range = useMemo(() => {
    const a = dayStart(from, tz);
    const b = dayStart(to, tz) + 86_400_000;
    return { a: new Date(a).toISOString(), b: new Date(b).toISOString(), ok: b > a };
  }, [from, to, tz]);

  const { data, error, loading } = useAsync(async () => {
    if (!range.ok) return null;
    const [quotes, lark, notes] = await Promise.all([
      seeQuotes
        ? supabase.from('quotes').select('id, code, client, service_group, requested_at, sent_at, band_result, source').eq('status', 'sent').eq('source', source).gte('sent_at', range.a).lt('sent_at', range.b).order('sent_at')
        : Promise.resolve({ data: [], error: null }),
      seeTasks ? supabase.from('lark_tasks').select(LARK_TASK_COLS).eq('kind', 'child').is('deleted_at', null).order('due_date') : Promise.resolve({ data: [], error: null }),
      seeTasks
        ? supabase.from('lark_notifications').select('task_id, local_date, kind, milestone, status, sent_at').gte('local_date', from).lte('local_date', to).order('local_date')
        : Promise.resolve({ data: [], error: null }),
    ]);
    return {
      quotes: check(quotes) as QuoteLite[],
      lark: check(lark) as LarkTaskRow[],
      notes: check(notes) as LarkNotifLite[],
    };
  }, [range.a, range.b, from, to, source, seeQuotes, seeTasks]);

  const k = useMemo(() => {
    if (!data) return null;
    const qs = data.quotes.map((q) => ({ id: q.id, requestedAt: Date.parse(q.requested_at), sentAt: Date.parse(q.sent_at), bandResult: q.band_result }));
    return {
      quote: quoteKpis(qs, calendar, late),
      weekly: weeklyTurnaround(qs, calendar, late),
      byBand: turnaroundByBand(qs, calendar, late),
      s1: larkPeriodKpis(
        data.lark.map((t) => ({ id: t.id, dueDate: t.due_date, completedAt: larkDone(t) })),
        data.notes.map((n) => ({ taskId: n.task_id, localDate: n.local_date, kind: n.kind, status: n.status })),
        from,
        to,
        Date.now(),
        tz,
      ),
    };
  }, [data, calendar, late, from, to, tz]);

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
  const exportLarkTasks = () =>
    k &&
    data &&
    downloadText(
      `kpi_lark_task_con_${fileTag}.csv`,
      toCsv(
        data.lark
          .filter((t) => k.s1.taskIds.includes(t.id))
          .map((t) => {
            const done = larkDone(t);
            return {
              code: t.code,
              parent_code: t.parent_code ?? '',
              name: t.name,
              assignee: t.assignee_name ?? '',
              due_date: t.due_date,
              completed_at: t.completed_at ? fmtVnDateTime(t.completed_at, tz) : '',
              code_errors: t.code_errors.join('; '),
              status: DUE_LABEL[larkDueStatus({ dueDate: t.due_date, completedAt: done }, Date.now(), tz)],
              late: ['late', 'overdue'].includes(larkDueStatus({ dueDate: t.due_date, completedAt: done }, Date.now(), tz)) ? 1 : 0,
            };
          }),
        ['code', 'parent_code', 'name', 'assignee', 'due_date', 'completed_at', 'code_errors', 'status', 'late'],
      ),
    );
  const exportLarkNotes = () =>
    data &&
    downloadText(
      `kpi_lark_nhac_viec_${fileTag}.csv`,
      toCsv(
        data.notes.map((n) => {
          const t = data.lark.find((x) => x.id === n.task_id);
          return { local_date: n.local_date, code: t?.code ?? '', assignee: t?.assignee_name ?? '', kind: n.kind, milestone: n.milestone ?? '', status: n.status, sent_at: n.sent_at ? fmtVnDateTime(n.sent_at, tz) : '' };
        }),
        ['local_date', 'code', 'assignee', 'kind', 'milestone', 'status', 'sent_at'],
      ),
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Dashboard KPI" subtitle="Mọi con số tính tự động từ mốc thời gian đã lưu, bằng giờ làm việc, theo đúng định nghĩa trong PRD." />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Từ ngày">{(id) => <Input id={id} type="date" value={from} onChange={(e) => { setTouched(true); setFrom(e.target.value); }} />}</Field>
        <Field label="Đến ngày">{(id) => <Input id={id} type="date" value={to} onChange={(e) => { setTouched(true); setTo(e.target.value); }} />}</Field>
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
        <Button variant="ghost" onClick={() => { setTouched(false); setFrom(defFrom); setTo(defTo); }}>
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
                title="Task e-commerce trên Lark (S1)"
                subtitle={`${k.s1.judged} task con đến hạn trong khoảng · ${k.s1.open} chưa đến hạn · tính từ task con Lark${settings?.lark_mode === 'simulation' ? ' (đang chạy chế độ mô phỏng)' : ''}`}
                actions={
                  <>
                    <Button size="sm" variant="secondary" icon="download" onClick={exportLarkTasks}>
                      CSV task con
                    </Button>
                    <Button size="sm" variant="secondary" icon="download" onClick={exportLarkNotes}>
                      CSV nhắc việc
                    </Button>
                  </>
                }
              >
                <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
                  <KpiTile
                    label="Tỷ lệ task con trễ hạn (M1)"
                    value={k.s1.latePct === null ? '–' : `${fmtNum(k.s1.latePct, 1)}%`}
                    base={`${fmtNum(base.task_overdue_pct, 1)}%`}
                    target={`< ${fmtNum(tgt.overdue_pct, 0)}%`}
                    good={k.s1.latePct === null ? null : k.s1.latePct < tgt.overdue_pct}
                    bar={{ base: base.task_overdue_pct, now: k.s1.latePct, target: tgt.overdue_pct }}
                  >
                    <div className="text-[13px] text-ink-3">
                      {k.s1.late + k.s1.openLate}/{k.s1.judged} task con · {k.s1.late} xong trễ, {k.s1.openLate} quá hạn chưa xong
                    </div>
                  </KpiTile>
                  <KpiTile
                    label="Hoàn thành đúng hạn"
                    value={k.s1.judged ? `${k.s1.onTime}/${k.s1.judged}` : '–'}
                    good={null}
                  >
                    <div className="text-[13px] text-ink-3">Task con Completed với mã hợp lệ, xong trước hoặc đúng ngày deadline.</div>
                  </KpiTile>
                  <KpiTile label="Bot đã nhắc" value={`${k.s1.reminders} lần`} good={null}>
                    <div className="text-[13px] text-ink-3">
                      {k.s1.remindedTasks} task con được nhắc · {k.s1.completions} xác nhận hoàn thành
                      {k.s1.failed ? <span className="text-bad"> · {k.s1.failed} lỗi gửi</span> : null}
                    </div>
                  </KpiTile>
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
                <QuoteKpiTiles
                  k={k.quote}
                  byBand={k.byBand}
                  settings={settings}
                  note={source === 'import' && <p className="mt-2 text-[12px] text-ink-3">Dữ liệu lịch sử không có kết quả khung giá.</p>}
                />
                <h3 className="mt-8 border-t border-line-soft pt-5 text-[15px] font-semibold text-ink">Thời gian báo giá trung bình theo tuần (giờ làm việc)</h3>
                {!k.weekly.length ? (
                  <p className="mt-2 text-sm text-ink-3">Chưa có báo giá nào được gửi trong khoảng này.</p>
                ) : table ? (
                  <table className="mt-2 w-full max-w-xl text-[14px]">
                    <thead className="text-left text-[13px] text-ink-3">
                      <tr className="border-b-2 border-ink">
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
