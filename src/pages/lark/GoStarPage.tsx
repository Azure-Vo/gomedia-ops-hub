import { useMemo, useState } from 'react';
import {
  fmtDueDate,
  KPI_STATUS_LABEL,
  KpiStatus,
  kpiTracked,
  personMonthStats,
  PersonMonthStats,
  TASK_STAGE_LABEL,
  TaskStage,
  DEFAULT_GOSTAR_RULES,
  employeeOfMonth,
  fmtVnd,
  GOSTAR_CRITERIA,
  GoStarCriterion,
  GoStarPerson,
  GoStarRow,
  GoStarRules,
  GoStarScore,
  goStarMessage,
  monthIsOver,
  monthKey,
  monthLabel,
  rankGoStar,
} from '@/domain';
import { Badge, Banner, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Textarea, cx, useAsync, useToast } from '@/components/ui';
import { Link } from 'react-router-dom';
import { fmtVnDateTime } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { BotCard } from './BotCard';

const SCORERS = ['pm', 'ecom_exec', 'ceo'];

interface ScoreRow {
  month: string;
  open_id: string;
  kpi_name: string;
  kpi_pct: number | null;
  quality: number | null;
  teamwork: number | null;
  note: string;
  updated_by: string;
  updated_at: string;
}
interface MonthRow {
  month: string;
  result: { rows: GoStarRow[]; rules: GoStarRules; computedAt: string };
  finalized_by: string;
  finalized_at: string;
}

const STAR_SHORT: Record<GoStarCriterion, string> = {
  completion: 'Hoàn thành',
  deadline: 'Đúng hạn',
  quality: 'Chất lượng',
  kpi: 'KPI',
  teamwork: 'Teamwork',
};

const STAR_PATH = 'M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z';

function StarMark({ on, px = 16 }: { on: boolean; px?: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true" className={on ? 'text-[#E39A12]' : 'text-ink/15'}>
      <path d={STAR_PATH} fill="currentColor" />
    </svg>
  );
}

function Stars({ n, px = 15 }: { n: number; px?: number }) {
  return (
    <span className="inline-flex items-center gap-px whitespace-nowrap" role="img" aria-label={`${n}/5 sao`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <StarMark key={i} on={i < n} px={px} />
      ))}
    </span>
  );
}

interface FactRow {
  assignee_open_id: string | null;
  kpi_due_date: string | null;
  due_date: string;
  state: TaskStage;
  accepted_at: string | null;
  pending_at: string | null;
}

export function GoStarPage() {
  const me = useProfile();
  const { tz } = useSettings();
  const toast = useToast();
  const now = Date.now();
  const thisMonth = monthKey(now, tz);
  const [month, setMonth] = useState(thisMonth);
  const [editing, setEditing] = useState<GoStarRow | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    const [people, tasks, scores, months, profiles] = await Promise.all([
      supabase.from('lark_people').select('open_id, name, profile_id'),
      // 1.6: one row per task with the KPI deadline and the approved submission (view task_kpi_facts).
      supabase.from('task_kpi_facts').select('assignee_open_id, kpi_due_date, due_date, state, accepted_at, pending_at'),
      supabase.from('gostar_scores').select('month, open_id, kpi_name, kpi_pct, quality, teamwork, note, updated_by, updated_at'),
      supabase.from('gostar_months').select('month, result, finalized_by, finalized_at'),
      supabase.from('profiles').select('id, full_name, email, role'),
    ]);
    return {
      people: check(people) as { open_id: string; name: string; profile_id: string | null }[],
      tasks: (check(tasks) as FactRow[])
        .map((t) => {
          const k = kpiTracked({ state: t.state, kpiDueDate: t.kpi_due_date ?? t.due_date, acceptedAt: t.accepted_at ? Date.parse(t.accepted_at) : null, pendingAt: t.pending_at ? Date.parse(t.pending_at) : null }, now, tz);
          return k ? { assignee_open_id: t.assignee_open_id, due_date: k.dueDate, completedAt: k.completedAt } : null;
        })
        .filter((t): t is { assignee_open_id: string | null; due_date: string; completedAt: number | null } => t !== null),
      scores: (check(scores) as ScoreRow[]).map((s) => ({ ...s, kpi_pct: s.kpi_pct === null ? null : Number(s.kpi_pct) })),
      months: check(months) as MonthRow[],
      profiles: check(profiles) as { id: string; full_name: string; email: string; role: string }[],
    };
  }, []);

  const months = useMemo(() => {
    const set = new Set<string>([thisMonth]);
    for (const t of data?.tasks ?? []) if (t.due_date.slice(0, 7) <= thisMonth) set.add(t.due_date.slice(0, 7));
    for (const m of data?.months ?? []) set.add(m.month);
    return [...set].sort().reverse();
  }, [data, thisMonth]);

  const closed = data?.months.find((m) => m.month === month) ?? null;
  const profileName = (id: string) => {
    const p = data?.profiles.find((x) => x.id === id);
    return p ? p.full_name || p.email : '—';
  };

  const live = useMemo(() => {
    if (!data) return [];
    const role = new Map(data.profiles.map((p) => [p.id, p.role]));
    const inMonth = data.tasks.filter((t) => t.due_date.slice(0, 7) === month);
    const scored = data.scores.filter((s) => s.month === month);
    // Ranked: staff, plus anyone who had a sub-task due this month or was scored this month.
    const roster: GoStarPerson[] = data.people
      .filter((p) => (p.profile_id && role.get(p.profile_id) === 'staff') || inMonth.some((t) => t.assignee_open_id === p.open_id) || scored.some((s) => s.open_id === p.open_id))
      .map((p) => ({ openId: p.open_id, name: p.name }));
    const scores = new Map<string, GoStarScore>(scored.map((s) => [s.open_id, { kpiPct: s.kpi_pct, quality: s.quality, teamwork: s.teamwork }]));
    return rankGoStar(
      roster,
      data.tasks.map((t) => ({ assigneeOpenId: t.assignee_open_id, dueDate: t.due_date, completedAt: t.completedAt })),
      scores,
      month,
      now,
      tz,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, month, tz]);

  const rows = closed ? closed.result.rows : live;
  const rules = closed?.result.rules ?? DEFAULT_GOSTAR_RULES;
  const scoreOf = (openId: string) => data?.scores.find((s) => s.month === month && s.open_id === openId) ?? null;
  const canScore = SCORERS.includes(me.role) && !closed;
  const isCeo = me.role === 'ceo';
  const over = monthIsOver(month, now, tz);
  const eom = employeeOfMonth(rows);
  const missing = rows.filter((r) => r.score.kpiPct === null || r.score.quality === null || r.score.teamwork === null).length;
  const notYetDue = rows.reduce((s, r) => s + r.tally.notYetDue, 0);
  const myOpenId = `sim:${me.id}`;

  async function closeMonth() {
    if (!window.confirm(`Chốt Go Star ${monthLabel(month)}? Sau khi chốt không sửa điểm được nữa.`)) return;
    setBusy(true);
    try {
      check(await supabase.from('gostar_months').insert({ month, finalized_by: me.id, result: { rows: live, rules: DEFAULT_GOSTAR_RULES, computedAt: new Date().toISOString() } }));
      toast(`Đã chốt ${monthLabel(month)}.`);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  async function reopen() {
    if (!window.confirm(`Mở lại ${monthLabel(month)} để sửa điểm? Bảng đã chốt sẽ bị xoá và tính lại.`)) return;
    setBusy(true);
    try {
      check(await supabase.from('gostar_months').delete().eq('month', month));
      toast(`Đã mở lại ${monthLabel(month)}.`);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Go Star · Ghi nhận nhân viên"
        info="Hạng 1 nhận thêm danh hiệu Employee of the Month. Người 0 sao không xếp hạng."
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Mỗi tiêu chí đạt = 1 sao</span>
            <span className="text-ink-2">🥇 1.000.000đ · 🥈 500.000đ · 🥉 200.000đ</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Chọn tháng" value={month} onChange={(e) => setMonth(e.target.value)} className="min-w-[160px]">
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                  {m === thisMonth ? ' (đang chạy)' : data?.months.some((x) => x.month === m) ? ' · đã chốt' : ''}
                </option>
              ))}
            </Select>
            {isCeo && !closed && (
              <Button icon="check" busy={busy} disabled={!over || !rows.length} onClick={closeMonth} title={over ? undefined : 'Chỉ chốt được sau ngày cuối tháng'}>
                Chốt tháng
              </Button>
            )}
            {isCeo && closed && (
              <Button variant="secondary" icon="refresh" busy={busy} onClick={reopen}>
                Mở lại
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <>
          {closed ? (
            <Banner tone="ok" title={`Đã chốt ${monthLabel(month)}`} className="mb-4">
              {profileName(closed.finalized_by)} chốt lúc {fmtVnDateTime(closed.finalized_at, tz)}. Kết quả đã khoá.
            </Banner>
          ) : over ? (
            <Banner tone="warn" title={`${monthLabel(month)} đã kết thúc, chưa chốt`} className="mb-4">
              {missing ? `Còn ${missing} người chưa đủ điểm Chất lượng / KPI / Teamwork. ` : 'Đã đủ điểm. '}
              {isCeo ? 'Bấm “Chốt tháng” để khoá bảng xếp hạng và tiền thưởng.' : 'Chờ CEO chốt tháng.'}
            </Banner>
          ) : (
            <Banner tone="info" title="Đang tạm tính" className="mb-4">
              2 sao tự tính, 3 sao quản lý chấm. CEO chốt sau ngày cuối tháng.
              {notYetDue ? ` ${notYetDue} task chưa tính.` : ''}
            </Banner>
          )}

          {!rows.length ? (
            <EmptyState title="Chưa có ai trong tháng này" />
          ) : (
            <>
              <div className="mb-8 grid border-y border-ink md:grid-cols-3">
                {[1, 2, 3].map((place) => {
                  const hit = rows.find((x) => x.rank === place) ?? rows.filter((x) => x.rank <= place).at(place - 1);
                  const r = hit && hit.starCount > 0 ? hit : undefined;
                  const isEom = r && eom.length === 1 && eom[0].openId === r.openId;
                  return (
                    <div key={place} className={cx('relative flex gap-4 border-line p-5 [&:not(:first-child)]:border-t md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-t-0', isEom && 'bg-brand-soft/60')}>
                      <div className={cx('w-10 shrink-0 text-[40px] font-semibold leading-none tracking-[-0.03em]', r ? (isEom ? 'text-brand' : 'text-ink') : 'text-ink-3')}>{r?.rank ?? place}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
                          <span>
                            Hạng {hit?.rank ?? place}
                            {r?.tied ? ' · đồng hạng' : ''}
                          </span>
                          {isEom && <Badge tone="brand">{closed ? 'Employee of the Month' : 'Dự kiến Employee of the Month'}</Badge>}
                        </div>
                        {r ? (
                          <>
                            <div className="mt-1 truncate text-[18px] font-semibold text-ink">{r.name}</div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <Stars n={r.starCount} px={18} />
                              <span className="text-[13px] font-medium text-ink-2">{r.starCount}/5</span>
                            </div>
                            <div className="mt-2 text-[14px] text-ink-2">
                              {closed ? 'Thưởng' : 'Thưởng dự kiến'}: <b className="font-semibold text-ink">{r.prize ? fmtVnd(r.prize) : '—'}</b>
                            </div>
                          </>
                        ) : (
                          <div className="mt-1 text-ink-3">Chưa có ai đạt sao</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {eom.length > 1 && (
                <Banner tone="warn" title="Đồng hạng 1" className="mb-4">
                  {eom.map((r) => r.name).join(', ')} bằng nhau ở cả số sao, KPI, chất lượng và teamwork. Tiền thưởng các hạng bị trùng đang chia đều; CEO quyết người nhận danh hiệu Employee of the Month.
                </Banner>
              )}

              <Card
                title={`Bảng xếp hạng ${monthLabel(month)}`}
                subtitle={`${rows.length} người`}
                info="Bằng sao thì so % KPI, rồi điểm Chất lượng, rồi Teamwork. Vẫn bằng thì đồng hạng, chia đều thưởng."
                className="mb-4"
              >
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[900px] text-[14px]">
                    <thead>
                      <tr className="border-b-2 border-ink text-left">
                        <th className="py-2 pr-2">Hạng</th>
                        <th className="py-2 pr-3">Nhân viên</th>
                        {GOSTAR_CRITERIA.map((c) => (
                          <th key={c.key} className="py-2 pr-2 text-center" title={c.label}>
                            {STAR_SHORT[c.key]}
                          </th>
                        ))}
                        <th className="py-2 pr-3">Tổng</th>
                        <th className="py-2 pr-3 text-right">{closed ? 'Thưởng' : 'Thưởng dự kiến'}</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const t = r.tally;
                        const sc = scoreOf(r.openId);
                        const detail: Record<GoStarCriterion, string> = {
                          completion: t.judged ? `${t.done}/${t.judged} task đã được duyệt` : 'Không có task đến hạn',
                          deadline: t.judged ? `Trễ ${t.late + t.openLate}/${t.judged} (${t.latePct}%)` : 'Không có task đến hạn',
                          quality: r.score.quality !== null ? `${r.score.quality}/5` : 'Chưa chấm',
                          kpi: r.score.kpiPct !== null ? `${r.score.kpiPct}%` : 'Chưa nhập',
                          teamwork: r.score.teamwork !== null ? `${r.score.teamwork}/5` : 'Chưa chấm',
                        };
                        return (
                          <tr key={r.openId} className={cx('border-b border-line-soft align-middle', r.openId === myOpenId && 'bg-brand-soft/40')}>
                            <td className="py-2.5 pr-2 text-[15px] font-semibold text-ink">
                              {r.starCount > 0 ? r.rank : <span className="text-ink-3" title="0 sao: không xếp hạng, không nhận thưởng">—</span>}
                            </td>
                            <td className="py-2.5 pr-3">
                              <div className="font-semibold text-ink">
                                {r.name}
                                {r.openId === myOpenId && <span className="ml-1 text-[12px] font-bold text-brand">(bạn)</span>}
                              </div>
                              {sc?.kpi_name && <div className="text-[12px] text-ink-3">KPI: {sc.kpi_name}</div>}
                            </td>
                            {GOSTAR_CRITERIA.map((c) => (
                              <td key={c.key} className="py-2.5 pr-2 text-center" title={`${c.name}: ${detail[c.key]}`}>
                                <div className="flex justify-center">
                                  <StarMark on={r.stars[c.key]} px={17} />
                                </div>
                                <div className={cx('mt-1 text-[12px]', r.stars[c.key] ? 'text-ink-2' : 'text-ink-3')}>{detail[c.key]}</div>
                              </td>
                            ))}
                            <td className="py-2.5 pr-3">
                              <Stars n={r.starCount} />
                            </td>
                            <td className="whitespace-nowrap py-2.5 pr-3 text-right font-semibold tabular-nums">{r.prize ? fmtVnd(r.prize) : <span className="text-ink-3">—</span>}</td>
                            <td className="py-2 text-right">
                              {canScore && (
                                <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                                  {sc ? 'Sửa điểm' : 'Chấm điểm'}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
                <Card title="Cách tính sao" subtitle="Ngưỡng tạm, chờ CEO chốt">
                  <ul className="flex flex-col gap-2.5 text-[14px] text-ink-2">
                    <li>
                      <b className="text-ink">1. Task Completion</b> (tự tính): mọi task đến hạn trong tháng đều đã được PM duyệt (≥ {rules.completionMinPct}%).
                    </li>
                    <li>
                      <b className="text-ink">2. Deadline</b> (tự tính): tỷ lệ task trễ trong tháng (theo lúc nộp, so với deadline tính KPI) dưới {rules.deadlineMaxLatePct}%, cùng chuẩn với chỉ số M1 của S1.
                    </li>
                    <li>
                      <b className="text-ink">3. Work Quality</b> (quản lý chấm): điểm chất lượng đầu ra từ {rules.qualityMinScore}/5 trở lên.
                    </li>
                    <li>
                      <b className="text-ink">4. KPI Achievement</b> (quản lý nhập): đạt từ {rules.kpiMinPct}% KPI cá nhân của tháng.
                    </li>
                    <li>
                      <b className="text-ink">5. Teamwork</b> (quản lý chấm): chủ động hỗ trợ, phối hợp với đồng đội từ {rules.teamworkMinScore}/5 trở lên.
                    </li>
                    <li className="border-t border-line-soft pt-2.5">
                      Bằng số sao thì so lần lượt: <b>% KPI</b> → <b>điểm Chất lượng</b> → <b>điểm Teamwork</b>. Vẫn bằng nhau thì đồng hạng, tiền thưởng của các hạng bị trùng chia đều. Người 0 sao không nhận thưởng.
                    </li>
                    <li>Người chấm: PM, E-com Exec, CEO. CEO chốt sau ngày cuối tháng.</li>
                  </ul>
                </Card>
                <div>
                  <h2 className="mb-2.5 text-[17px] font-semibold text-ink">Tin vinh danh trên group Lark</h2>
                  <BotCard message={goStarMessage(month, rows, (v) => fmtVnd(v))} />
                  <p className="mt-2 px-1 text-[12.5px] text-ink-3">
                    {closed ? 'Tin của tháng đã chốt.' : 'Xem trước, theo số liệu tạm tính.'} Chưa tự gửi lên Lark.
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {editing && data && (
        <ScoreModal
          row={editing}
          month={month}
          existing={scoreOf(editing.openId)}
          meId={me.id}
          updatedByName={(id) => profileName(id)}
          tz={tz}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ScoreModal({
  row,
  month,
  existing,
  meId,
  updatedByName,
  tz,
  onClose,
  onSaved,
}: {
  row: GoStarRow;
  month: string;
  existing: ScoreRow | null;
  meId: string;
  updatedByName: (id: string) => string;
  tz: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [kpiName, setKpiName] = useState(existing?.kpi_name ?? '');
  const [kpi, setKpi] = useState(existing?.kpi_pct?.toString() ?? '');
  const [quality, setQuality] = useState(existing?.quality?.toString() ?? '');
  const [teamwork, setTeamwork] = useState(existing?.teamwork?.toString() ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const kpiNum = kpi.trim() === '' ? null : Number(kpi.replace(',', '.'));
  const kpiErr = kpiNum !== null && (!Number.isFinite(kpiNum) || kpiNum < 0 || kpiNum > 300) ? 'Nhập % từ 0 đến 300.' : null;
  const facts = useAsync(() => loadPersonMonth(row.openId, month, tz), [row.openId, month]);

  async function save() {
    setBusy(true);
    try {
      check(
        await supabase.from('gostar_scores').upsert(
          {
            month,
            open_id: row.openId,
            kpi_name: kpiName.trim(),
            kpi_pct: kpiNum,
            quality: quality ? Number(quality) : null,
            teamwork: teamwork ? Number(teamwork) : null,
            note: note.trim(),
            updated_by: meId,
          },
          { onConflict: 'month,open_id' },
        ),
      );
      toast(`Đã lưu điểm của ${row.name}.`);
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const scale = (
    <>
      <option value="">Chưa chấm</option>
      <option value="5">5 · Vượt kỳ vọng</option>
      <option value="4">4 · Đạt tốt</option>
      <option value="3">3 · Đạt, còn phải sửa</option>
      <option value="2">2 · Chưa đạt</option>
      <option value="1">1 · Kém</option>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      wide="xl"
      title={`Chấm điểm ${monthLabel(month)} · ${row.name}`}
      footer={
        <>
          {existing && <span className="mr-auto self-center text-[12.5px] text-ink-3">Sửa lần cuối: {updatedByName(existing.updated_by)} · {fmtVnDateTime(existing.updated_at, tz)}</span>}
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button icon="check" busy={busy} disabled={!!kpiErr} onClick={save}>
            Lưu điểm
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* left: what the PM decides */}
        <div className="flex flex-col gap-3 lg:order-1">
          <h3 className="text-[14px] font-semibold text-ink">Điểm quản lý chấm</h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <Field label="KPI cá nhân" hint="VD: 4 video đúng lịch">
              {(id) => <Input id={id} value={kpiName} onChange={(e) => setKpiName(e.target.value)} maxLength={120} />}
            </Field>
            <Field label="% đạt" hint="≥ 100% → 1 sao" error={kpiErr}>
              {(id) => <Input id={id} inputMode="decimal" value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="105" />}
            </Field>
          </div>
          <Field label="Work Quality" hint={facts.data && facts.data.onTime + facts.data.late > 0 ? `≥ 4 → 1 sao · ${facts.data.firstPass}/${facts.data.onTime + facts.data.late} duyệt ngay lần đầu` : '≥ 4 → 1 sao'}>
            {(id) => (
              <Select id={id} value={quality} onChange={(e) => setQuality(e.target.value)}>
                {scale}
              </Select>
            )}
          </Field>
          <Field label="Teamwork" hint="≥ 4 → 1 sao">
            {(id) => (
              <Select id={id} value={teamwork} onChange={(e) => setTeamwork(e.target.value)}>
                {scale}
              </Select>
            )}
          </Field>
          <Field label="Ghi chú, dẫn chứng">
            {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: hỗ trợ Duyên dựng video KN032" />}
          </Field>
        </div>
        {/* right: what the person did this month */}
        <div className="min-w-0 lg:order-2 lg:border-l lg:border-line-soft lg:pl-6">
          <PersonFacts state={facts} name={row.name} month={month} row={row} />
        </div>
      </div>
    </Modal>
  );
}

/** The month's tasks of one person, with rounds, extensions and check-ins (for the scoring modal). */
async function loadPersonMonth(openId: string, month: string, tz: string): Promise<PersonMonthStats> {
  const rows = check(
    await supabase
      .from('lark_tasks')
      .select('id, code, name, state, due_date, kpi_due_date, accepted_at')
      .eq('kind', 'child')
      .eq('assignee_open_id', openId)
      .is('deleted_at', null)
      // Window wide enough for any KPI deadline in the month; personMonthStats picks the month exactly.
      .gte('due_date', `${shiftMonthKey(month, -3)}-01`),
  ) as { id: string; code: string | null; name: string; state: TaskStage; due_date: string; kpi_due_date: string | null; accepted_at: string | null }[];
  const ids = rows.filter((r) => (r.kpi_due_date ?? r.due_date).slice(0, 7) === month).map((r) => r.id);
  const [subs, exts, checkins] = ids.length
    ? await Promise.all([
        supabase.from('task_submissions').select('task_id, round, decision, submitted_at').in('task_id', ids),
        supabase.from('task_extensions').select('task_id, reason').in('task_id', ids),
        supabase.from('task_checkins').select('task_id, sent_at, answer').in('task_id', ids),
      ]).then(([a, b, c]) => [check(a), check(b), check(c)] as const)
    : ([[], [], []] as const);
  const subRows = subs as { task_id: string; round: number; decision: 'approved' | 'changes' | null; submitted_at: string }[];
  const pendingAt = (id: string) => {
    const open = subRows.filter((x) => x.task_id === id && x.decision === null).sort((a, b) => b.round - a.round)[0];
    return open ? Date.parse(open.submitted_at) : null;
  };
  return personMonthStats(
    month,
    rows.map((r) => ({ id: r.id, code: r.code ?? '—', name: r.name, state: r.state, kpiDueDate: r.kpi_due_date ?? r.due_date, acceptedAt: r.accepted_at ? Date.parse(r.accepted_at) : null, pendingAt: pendingAt(r.id) })),
    subRows,
    exts as { task_id: string; reason: 'scope' | 'quality' }[],
    checkins as { task_id: string; sent_at: string | null; answer: 'on_plan' | 'behind' | 'blocked' | null }[],
    Date.now(),
    tz,
  );
}

const STATUS_TONE: Record<KpiStatus, 'ok' | 'bad' | 'warn' | 'neutral' | 'brand'> = { on_time: 'ok', late: 'bad', overdue: 'bad', pending: 'brand', open: 'neutral', excluded: 'neutral' };

function Tile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div className="rounded-lg border border-line-soft bg-canvas/50 px-3 py-2">
      <div className="text-[12.5px] font-medium text-ink-3">{label}</div>
      <div className={cx('text-[20px] font-semibold leading-tight tracking-[-0.01em]', tone === 'ok' ? 'text-ok-ink' : tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[12px] leading-snug text-ink-3">{sub}</div>}
    </div>
  );
}

function PersonFacts({ state, name, month, row }: { state: { data: PersonMonthStats | null; error: unknown; loading: boolean }; name: string; month: string; row: GoStarRow }) {
  if (state.error) return <ErrorBox error={state.error} />;
  if (!state.data) return <div className="mb-4 h-[120px] animate-pulse rounded-lg bg-canvas" aria-label="Đang tải số liệu" />;
  const s = state.data;
  const judged = s.onTime + s.late + s.overdue;
  const latePct = judged ? Math.round(((s.late + s.overdue) / judged) * 100) : null;
  const approved = s.onTime + s.late;
  return (
    <section aria-label={`Số liệu ${monthLabel(month)} của ${name}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">Số liệu {monthLabel(month).toLowerCase()}</h3>
        <div className="flex gap-1.5">
          {GOSTAR_CRITERIA.filter((c) => c.source === 'lark').map((c) => (
            <Badge key={c.key} tone={row.stars[c.key] ? 'ok' : 'neutral'}>
              {row.stars[c.key] ? '★' : '☆'} {c.name}
            </Badge>
          ))}
        </div>
      </div>
      {!s.total ? (
        <p className="rounded-lg bg-canvas px-3 py-3 text-[14px] text-ink-3">{name} không có task nào có deadline trong tháng này.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label="Task trong tháng" value={s.total} sub={`${approved} đã duyệt${s.pending ? ` · ${s.pending} chờ duyệt` : ''}${s.open ? ` · ${s.open} chưa đến hạn` : ''}`} />
            <Tile label="Đúng hạn" value={`${s.onTime}/${judged || 0}`} sub="Theo lúc nộp" tone={judged && s.onTime === judged ? 'ok' : undefined} />
            <Tile label="Trễ / quá hạn" value={latePct === null ? '—' : `${latePct}%`} sub={`${s.late} nộp trễ · ${s.overdue} chưa nộp`} tone={latePct === null ? undefined : latePct < 20 ? 'ok' : 'bad'} />
            <Tile label="Duyệt ngay lần đầu" value={approved ? `${s.firstPass}/${approved}` : '—'} sub={`${s.sentBack} lần bị trả về sửa`} tone={approved && s.firstPass / approved >= 0.8 ? 'ok' : s.sentBack ? 'warn' : undefined} />
            <Tile label="Gia hạn" value={s.extScope + s.extQuality} sub={`${s.extScope} đổi yêu cầu · ${s.extQuality} do người làm`} tone={s.extQuality ? 'warn' : undefined} />
            <Tile label="Trả lời tiến độ" value={s.asked ? `${s.answered}/${s.asked}` : '—'} sub={s.blocked || s.behind ? `${s.blocked} bị chặn · ${s.behind} chậm` : 'Không báo chậm'} tone={s.asked && s.answered < s.asked ? 'warn' : undefined} />
          </div>
          <div className="mt-3 rounded-lg border border-line-soft">
            <div className="px-3 py-2 text-[13px] font-semibold text-ink-2">{s.total} task tính trong tháng</div>
            <div className="max-h-72 overflow-y-auto border-t border-line-soft">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="px-3 py-1.5 font-medium">Task</th>
                    <th className="px-2 py-1.5 font-medium">Deadline KPI</th>
                    <th className="px-2 py-1.5 font-medium">Kết quả</th>
                    <th className="px-2 py-1.5 text-right font-medium">Lần nộp</th>
                    <th className="px-3 py-1.5 text-right font-medium">Gia hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {s.tasks.map((t) => (
                    <tr key={t.id} className="border-t border-line-soft">
                      <td className="max-w-[260px] px-3 py-1.5">
                        <Link to={`/du-an/${encodeURIComponent(t.code.split('-')[0])}?task=${t.id}`} target="_blank" rel="noopener" className="block truncate hover:underline" title={`${t.code} · ${t.name} · ${TASK_STAGE_LABEL[t.state]} (mở ở tab mới)`}>
                          <span className="font-mono text-[12px] text-brand">{t.code}</span> {t.name}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5 text-ink-2">{fmtDueDate(t.kpiDueDate).slice(0, 5)}</td>
                      <td className="px-2 py-1.5">
                        <Badge tone={STATUS_TONE[t.status]}>{KPI_STATUS_LABEL[t.status]}</Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right text-ink-2">
                        {t.rounds}
                        {t.sentBack > 0 && <span className="text-warn"> ({t.sentBack} sửa)</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink-2">{t.extensions || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <p className="mt-2 text-[12.5px] text-ink-3">Hai sao trên tự tính, không chấm tay.</p>
    </section>
  );
}

function shiftMonthKey(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
