import { useEffect, useMemo, useState } from 'react';
import { EXTEND_REASON_LABEL, fmtNum, kpiTracked, larkDueStatus, larkPeriodKpis, localToMs, quoteKpis, TaskStage, turnaroundByBand, weeklyTurnaround, workingHoursBetween } from '@/domain';
import { Banner, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, useAsync } from '@/components/ui';
import { downloadText, toCsv } from '@/lib/csv';
import { fmtVnDateTime, toDateInput } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import type { BotMessageRow } from '../work/data';
import { MessageHistory } from '../work/parts';
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

const DUE_LABEL = { on_time: 'đúng hạn', late: 'nộp trễ', overdue: 'quá hạn chưa xong', open: 'chưa đến hạn' } as const;

interface TaskLite {
  id: string;
  code: string;
  parent_code: string | null;
  name: string;
  assignee_name: string | null;
  due_date: string;
  kpi_due_date: string | null;
  state: TaskStage;
  accepted_at: string | null;
}
interface SubLite {
  task_id: string;
  round: number;
  submitted_at: string;
  decision: 'approved' | 'changes' | null;
  decided_at: string | null;
}

function dayStart(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return localToMs(y, m, d, 0, 0, tz);
}

export function DashboardPage() {
  const me = useProfile();
  const { settings, calendar, tz } = useSettings();
  const seeQuotes = ['pm', 'ceo', 'admin'].includes(me.role);
  const seeTasks = ['pm', 'ceo', 'admin'].includes(me.role);
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
    const none = Promise.resolve({ data: [], error: null });
    const [quotes, lark, notes, subs, msgs, exts, checkins] = await Promise.all([
      seeQuotes
        ? supabase.from('quotes').select('id, code, client, service_group, requested_at, sent_at, band_result, source').eq('status', 'sent').eq('source', source).gte('sent_at', range.a).lt('sent_at', range.b).order('sent_at')
        : Promise.resolve({ data: [], error: null }),
      seeTasks ? supabase.from('lark_tasks').select('id, code, parent_code, name, assignee_name, due_date, kpi_due_date, state, accepted_at').eq('kind', 'child').is('deleted_at', null).order('due_date') : none,
      // 1.5 reminders (before 1.6) are still counted.
      seeTasks ? supabase.from('lark_notifications').select('task_id, local_date, kind, milestone, status, sent_at').gte('local_date', from).lte('local_date', to).order('local_date') : none,
      seeTasks ? supabase.from('task_submissions').select('task_id, round, submitted_at, decision, decided_at') : none,
      seeTasks ? supabase.from('bot_messages').select('id, project_id, task_id, kind, channel, to_name, local_date, status, attempts, last_error, message, sent_at, created_at').gte('local_date', from).lte('local_date', to).order('created_at', { ascending: false }) : none,
      seeTasks ? supabase.from('task_extensions').select('task_id, reason, created_at').gte('created_at', range.a).lt('created_at', range.b) : none,
      seeTasks ? supabase.from('task_checkins').select('task_id, sent_at, answered_at, answer').gte('sent_at', range.a).lt('sent_at', range.b) : none,
    ]);
    const msgRows = check(msgs) as BotMessageRow[];
    const newNotes: LarkNotifLite[] = msgRows
      .filter((m) => m.task_id && (m.kind === 'reminder' || m.kind === 'approved'))
      .map((m) => ({ task_id: m.task_id!, local_date: m.local_date, kind: m.kind === 'reminder' ? 'reminder' : 'completion', milestone: m.message.badge ?? null, status: m.status, sent_at: m.sent_at }));
    return {
      quotes: check(quotes) as QuoteLite[],
      lark: check(lark) as TaskLite[],
      notes: [...(check(notes) as LarkNotifLite[]), ...newNotes],
      subs: check(subs) as SubLite[],
      summaries: msgRows.filter((m) => m.kind.startsWith('summary_')),
      exts: check(exts) as { task_id: string; reason: 'scope' | 'quality' }[],
      checkins: check(checkins) as { task_id: string; sent_at: string; answered_at: string | null; answer: string | null }[],
    };
  }, [range.a, range.b, from, to, source, seeQuotes, seeTasks]);

  const k = useMemo(() => {
    if (!data) return null;
    // 1.6 (PRD 9.1): on time = the approved submission was made by the KPI deadline; an on-time
    // submission still waiting for review is not judged yet.
    const pendingAt = new Map<string, number>();
    for (const sub of data.subs) if (!sub.decision) pendingAt.set(sub.task_id, Date.parse(sub.submitted_at));
    const tracked = data.lark
      .map((t) => {
        const r = kpiTracked({ state: t.state, kpiDueDate: t.kpi_due_date ?? t.due_date, acceptedAt: t.accepted_at ? Date.parse(t.accepted_at) : null, pendingAt: pendingAt.get(t.id) ?? null }, Date.now(), tz);
        return r ? { id: t.id, ...r } : null;
      })
      .filter((t): t is { id: string; dueDate: string; completedAt: number | null } => t !== null);
    const qs = data.quotes.map((q) => ({ id: q.id, requestedAt: Date.parse(q.requested_at), sentAt: Date.parse(q.sent_at), bandResult: q.band_result }));
    return {
      quote: quoteKpis(qs, calendar, late),
      weekly: weeklyTurnaround(qs, calendar, late),
      byBand: turnaroundByBand(qs, calendar, late),
      s1: larkPeriodKpis(
        tracked,
        data.notes.map((n) => ({ taskId: n.task_id, localDate: n.local_date, kind: n.kind, status: n.status })),
        from,
        to,
        Date.now(),
        tz,
      ),
      tracked,
      extra: (() => {
        const due = new Set(tracked.filter((t) => t.dueDate >= from && t.dueDate <= to).map((t) => t.id));
        const decided = data.subs.filter((s) => due.has(s.task_id) && s.decision);
        const reviewed = new Set(decided.map((s) => s.task_id));
        const sentBack = new Set(decided.filter((s) => s.decision === 'changes').map((s) => s.task_id));
        const hours = decided.filter((s) => s.decided_at).map((s) => workingHoursBetween(s.submitted_at, s.decided_at!, calendar));
        const answered = data.checkins.filter((c) => c.answered_at).length;
        return {
          changesPct: reviewed.size ? Math.round((sentBack.size / reviewed.size) * 1000) / 10 : null,
          sentBack: sentBack.size,
          reviewed: reviewed.size,
          reviewHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
          asked: data.checkins.length,
          answered,
          blocked: data.checkins.filter((c) => c.answer === 'blocked').length,
          extScope: data.exts.filter((e) => e.reason === 'scope').length,
          extQuality: data.exts.filter((e) => e.reason === 'quality').length,
        };
      })(),
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
      `kpi_task_${fileTag}.csv`,
      toCsv(
        k.tracked
          .filter((x) => k.s1.taskIds.includes(x.id))
          .map((x) => {
            const t = data.lark.find((y) => y.id === x.id)!;
            const st = larkDueStatus({ dueDate: x.dueDate, completedAt: x.completedAt }, Date.now(), tz);
            return {
              code: t.code,
              project: t.parent_code ?? '',
              name: t.name,
              assignee: t.assignee_name ?? '',
              due_date: t.due_date,
              kpi_due_date: x.dueDate,
              accepted_submitted_at: x.completedAt ? fmtVnDateTime(new Date(x.completedAt).toISOString(), tz) : '',
              status: DUE_LABEL[st],
              late: st === 'late' || st === 'overdue' ? 1 : 0,
            };
          }),
        ['code', 'project', 'name', 'assignee', 'due_date', 'kpi_due_date', 'accepted_submitted_at', 'status', 'late'],
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
      <PageHeader title="Dashboard KPI" subtitle="Tự tính từ dữ liệu, theo giờ làm việc."
        info="Mỗi chỉ số dùng đúng định nghĩa trong PRD. Mẫu nhỏ (khoảng 6 báo giá và 15 task mỗi tháng) nên kết quả 4 tuần chỉ mang tính chỉ báo: gắn nhãn P/A khi đưa vào báo cáo." />
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
                title="Dự án & Task (S1)"
                subtitle={`${k.s1.judged} task đã tính · ${k.s1.open} chưa tính${settings?.lark_mode === 'simulation' ? ' · mô phỏng' : ''}`}
                info="Task tính khi có deadline tính KPI trong khoảng ngày. Chưa tính: chưa đến hạn hoặc đang chờ duyệt."
                actions={
                  <>
                    <Button size="sm" variant="secondary" icon="download" onClick={exportLarkTasks}>
                      CSV task
                    </Button>
                    <Button size="sm" variant="secondary" icon="download" onClick={exportLarkNotes}>
                      CSV nhắc việc
                    </Button>
                  </>
                }
              >
                <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
                  <KpiTile
                    label="Tỷ lệ task trễ hạn (M1)"
                    value={k.s1.latePct === null ? '–' : `${fmtNum(k.s1.latePct, 1)}%`}
                    base={`${fmtNum(base.task_overdue_pct, 1)}%`}
                    target={`< ${fmtNum(tgt.overdue_pct, 0)}%`}
                    good={k.s1.latePct === null ? null : k.s1.latePct < tgt.overdue_pct}
                    bar={{ base: base.task_overdue_pct, now: k.s1.latePct, target: tgt.overdue_pct }}
                  >
                    <div className="text-[13px] text-ink-3">
                      {k.s1.late + k.s1.openLate}/{k.s1.judged} task · {k.s1.late} nộp trễ, {k.s1.openLate} quá hạn chưa xong
                    </div>
                  </KpiTile>
                  <KpiTile
                    label="Hoàn thành đúng hạn"
                    value={k.s1.judged ? `${k.s1.onTime}/${k.s1.judged}` : '–'}
                    good={null}
                  >
                    <div className="text-[13px] text-ink-3">Nộp đúng deadline tính KPI, được duyệt.</div>
                  </KpiTile>
                  <KpiTile label="Bot đã nhắc" value={`${k.s1.reminders} lần`} good={null}>
                    <div className="text-[13px] text-ink-3">
                      {k.s1.remindedTasks} task được nhắc · {k.s1.completions} task được duyệt
                      {k.s1.failed ? <span className="text-bad"> · {k.s1.failed} lỗi gửi</span> : null}
                    </div>
                  </KpiTile>
                </div>
                <div className="mt-6 grid gap-x-8 gap-y-6 border-t border-line-soft pt-5 md:grid-cols-4">
                  <KpiTile label="Phải sửa ít nhất 1 lần" value={k.extra.changesPct === null ? '–' : `${fmtNum(k.extra.changesPct, 1)}%`} good={null}>
                    <div className="text-[13px] text-ink-3">
                      {k.extra.sentBack}/{k.extra.reviewed} task đã được xét duyệt
                    </div>
                  </KpiTile>
                  <KpiTile label="Thời gian duyệt TB" value={k.extra.reviewHours === null ? '–' : `${fmtNum(k.extra.reviewHours, 1)} giờ`} good={null}>
                    <div className="text-[13px] text-ink-3">Giờ làm việc từ lúc nộp đến lúc PM quyết định.</div>
                  </KpiTile>
                  <KpiTile label="Trả lời hỏi tiến độ" value={k.extra.asked ? `${k.extra.answered}/${k.extra.asked}` : '–'} good={null}>
                    <div className="text-[13px] text-ink-3">{k.extra.blocked} lần báo bị chặn</div>
                  </KpiTile>
                  <KpiTile label="Gia hạn" value={`${k.extra.extScope + k.extra.extQuality} lần`} good={null}>
                    <div className="text-[13px] text-ink-3">
                      {EXTEND_REASON_LABEL.scope}: {k.extra.extScope} · {EXTEND_REASON_LABEL.quality}: {k.extra.extQuality}
                    </div>
                  </KpiTile>
                </div>
              </Card>
            )}
            {seeTasks && data && (
              <Card title="Lịch sử bản tóm tắt gửi PM" subtitle="Số liệu lúc gửi tin 08:30 và 17:30.">
                <MessageHistory messages={data.summaries} />
              </Card>
            )}
            {seeQuotes && (
              <Card
                title="Báo giá (S2)"
                subtitle={`${k.quote.count} báo giá đã gửi`}
                info="Thời gian báo giá = giờ làm việc từ lúc khách yêu cầu đến lúc gửi."
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
