import { useMemo, useState } from 'react';
import {
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
import { Badge, Banner, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Textarea, cx, useAsync, useToast } from '@/components/ui';
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

function Stars({ n, size = 'text-[15px]' }: { n: number; size?: string }) {
  return (
    <span className={cx('whitespace-nowrap tracking-tight', size)} aria-label={`${n}/5 sao`}>
      <span className="text-[#F5A524]">{'★'.repeat(n)}</span>
      <span className="text-line">{'★'.repeat(5 - n)}</span>
    </span>
  );
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
      supabase.from('lark_tasks').select('assignee_open_id, due_date, closed_at, completed_at').eq('kind', 'child').is('deleted_at', null),
      supabase.from('gostar_scores').select('month, open_id, kpi_name, kpi_pct, quality, teamwork, note, updated_by, updated_at'),
      supabase.from('gostar_months').select('month, result, finalized_by, finalized_at'),
      supabase.from('profiles').select('id, full_name, email, role'),
    ]);
    return {
      people: check(people) as { open_id: string; name: string; profile_id: string | null }[],
      tasks: check(tasks) as { assignee_open_id: string | null; due_date: string; closed_at: string | null; completed_at: string | null }[],
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
      data.tasks.map((t) => ({ assigneeOpenId: t.assignee_open_id, dueDate: t.due_date, completedAt: t.closed_at ? Date.parse(t.completed_at ?? t.closed_at) : null })),
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
    if (!window.confirm(`Chốt Go Star ${monthLabel(month)}? Sau khi chốt, bảng xếp hạng và tiền thưởng được giữ nguyên, điểm của tháng không sửa được nữa.`)) return;
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
        subtitle="Mỗi tiêu chí đạt yêu cầu được 1 sao/tháng, tối đa 5 sao. Cuối tháng xếp hạng: hạng 1 nhận 1.000.000đ và danh hiệu “Employee of the Month”, hạng 2 nhận 500.000đ, hạng 3 nhận 200.000đ."
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
              {profileName(closed.finalized_by)} chốt lúc {fmtVnDateTime(closed.finalized_at, tz)}. Bảng dưới đây là kết quả đã khoá; điểm của tháng không sửa được nữa.
            </Banner>
          ) : over ? (
            <Banner tone="warn" title={`${monthLabel(month)} đã kết thúc, chưa chốt`} className="mb-4">
              {missing ? `Còn ${missing} người chưa đủ điểm Chất lượng / KPI / Teamwork. ` : 'Đã đủ điểm. '}
              {isCeo ? 'Bấm “Chốt tháng” để khoá bảng xếp hạng và tiền thưởng.' : 'Chờ CEO chốt tháng.'}
            </Banner>
          ) : (
            <Banner tone="info" title="Đang tạm tính" className="mb-4">
              Hai sao Task Completion và Deadline tự tính từ task con trên Lark đến hôm nay
              {notYetDue ? ` (còn ${notYetDue} task con chưa đến hạn trong tháng, chưa tính)` : ''}. Ba sao còn lại theo điểm quản lý chấm. CEO chốt sau ngày cuối tháng.
            </Banner>
          )}

          {!rows.length ? (
            <EmptyState title="Chưa có nhân viên nào trong tháng này">Bảng xếp hạng gồm nhân viên và những ai có task con đến hạn trong tháng trên Lark.</EmptyState>
          ) : (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                {[1, 2, 3].map((place) => {
                  const hit = rows.find((x) => x.rank === place) ?? rows.filter((x) => x.rank <= place).at(place - 1);
                  const r = hit && hit.starCount > 0 ? hit : undefined;
                  const medal = ['🥇', '🥈', '🥉'][place - 1];
                  const isEom = r && eom.length === 1 && eom[0].openId === r.openId;
                  return (
                    <div key={place} className={cx('rounded-2xl border p-4', isEom ? 'border-[#F5C76B] bg-[#FFF8E6]' : 'border-line bg-white')}>
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-bold uppercase tracking-wide text-ink-3">
                          {medal} Hạng {hit?.rank ?? place}
                          {r?.tied ? ' · đồng hạng' : ''}
                        </span>
                        {isEom && <Badge tone="accent">{closed ? 'Employee of the Month' : 'Dự kiến Employee of the Month'}</Badge>}
                      </div>
                      {r ? (
                        <>
                          <div className="mt-2 text-[19px] font-extrabold text-ink">{r.name}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <Stars n={r.starCount} size="text-[20px]" />
                            <span className="text-[13px] font-bold text-ink-2">{r.starCount}/5</span>
                          </div>
                          <div className="mt-2 text-[14px] text-ink-2">
                            {closed ? 'Thưởng' : 'Thưởng dự kiến'}: <b className="text-ink">{r.prize ? fmtVnd(r.prize) : '—'}</b>
                          </div>
                        </>
                      ) : (
                        <div className="mt-2 text-ink-3">Chưa có ai đạt sao</div>
                      )}
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
                subtitle={`${rows.length} người · cùng số sao thì xét KPI, rồi Chất lượng, rồi Teamwork (mức độ đóng góp)`}
                className="mb-4"
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-[14px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[12px] uppercase tracking-wide text-ink-3">
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
                          completion: t.judged ? `${t.done}/${t.judged} task con đã xong` : 'Không có task con đến hạn',
                          deadline: t.judged ? `Trễ ${t.late + t.openLate}/${t.judged} (${t.latePct}%)` : 'Không có task con đến hạn',
                          quality: r.score.quality !== null ? `${r.score.quality}/5` : 'Chưa chấm',
                          kpi: r.score.kpiPct !== null ? `${r.score.kpiPct}%` : 'Chưa nhập',
                          teamwork: r.score.teamwork !== null ? `${r.score.teamwork}/5` : 'Chưa chấm',
                        };
                        return (
                          <tr key={r.openId} className={cx('border-b border-line-soft align-middle', r.openId === myOpenId && 'bg-brand-soft/40')}>
                            <td className="py-2.5 pr-2 font-extrabold text-ink">
                              {r.rank <= 3 && r.starCount > 0 ? ['🥇', '🥈', '🥉'][r.rank - 1] : ''} {r.rank}
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
                                <div className={cx('text-[18px] leading-none', r.stars[c.key] ? 'text-[#F5A524]' : 'text-line')}>★</div>
                                <div className="mt-0.5 text-[11.5px] text-ink-3">{detail[c.key]}</div>
                              </td>
                            ))}
                            <td className="py-2.5 pr-3">
                              <Stars n={r.starCount} />
                            </td>
                            <td className="whitespace-nowrap py-2.5 pr-3 text-right font-bold tabular-nums">{r.prize ? fmtVnd(r.prize) : '—'}</td>
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
                <Card title="Cách tính sao" subtitle="Ngưỡng hiện tại là giả định của nhóm, chờ CEO chốt">
                  <ul className="flex flex-col gap-2.5 text-[14px] text-ink-2">
                    <li>
                      <b className="text-ink">1. Task Completion</b> (tự tính từ Lark): mọi task con đến hạn trong tháng đều Completed với mã hợp lệ (≥ {rules.completionMinPct}%).
                    </li>
                    <li>
                      <b className="text-ink">2. Deadline</b> (tự tính từ Lark): tỷ lệ task con trễ trong tháng dưới {rules.deadlineMaxLatePct}%, cùng chuẩn với chỉ số M1 của S1.
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
                    <li>Chấm điểm: PM, E-com Exec, CEO. CEO chốt tháng sau ngày cuối tháng; đã chốt thì không sửa được điểm.</li>
                  </ul>
                </Card>
                <div>
                  <div className="mb-2 text-[13px] font-extrabold uppercase tracking-wide text-ink-3">Tin vinh danh trên group Lark</div>
                  <BotCard message={goStarMessage(month, rows, (v) => fmtVnd(v))} />
                  <p className="mt-2 px-1 text-[12.5px] text-ink-3">
                    {closed ? 'Nội dung tin vinh danh của tháng đã chốt.' : 'Xem trước theo số liệu tạm tính; tin chính thức theo kết quả lúc CEO chốt tháng.'} Bước bot tự gửi lên group Lark chưa làm.
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
  const t = row.tally;

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
      title={`Chấm điểm ${monthLabel(month)} · ${row.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button icon="check" busy={busy} disabled={!!kpiErr} onClick={save}>
            Lưu điểm
          </Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Task con đã xong" value={`${t.done}/${t.judged}`} sub={t.notYetDue ? `+${t.notYetDue} chưa đến hạn` : undefined} />
        <Stat label="Đúng hạn" value={t.onTime} />
        <Stat label="Tỷ lệ trễ" value={t.latePct === null ? '—' : `${t.latePct}%`} tone={t.latePct === null ? null : t.latePct < 20 ? 'ok' : 'bad'} />
      </div>
      <p className="mb-4 text-[13px] text-ink-3">Hai sao Task Completion và Deadline tự tính từ Lark, không chấm tay.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="KPI cá nhân của tháng" hint="Vd: 4 video đăng đúng lịch, doanh số shop…">
          {(id) => <Input id={id} value={kpiName} onChange={(e) => setKpiName(e.target.value)} maxLength={120} />}
        </Field>
        <Field label="% KPI đạt được" hint="Đạt từ 100% được 1 sao" error={kpiErr}>
          {(id) => <Input id={id} inputMode="decimal" value={kpi} onChange={(e) => setKpi(e.target.value)} placeholder="vd 105" />}
        </Field>
        <Field label="Work Quality (chất lượng đầu ra)" hint="Từ 4/5 được 1 sao">
          {(id) => (
            <Select id={id} value={quality} onChange={(e) => setQuality(e.target.value)}>
              {scale}
            </Select>
          )}
        </Field>
        <Field label="Teamwork (hỗ trợ, phối hợp)" hint="Từ 4/5 được 1 sao">
          {(id) => (
            <Select id={id} value={teamwork} onChange={(e) => setTeamwork(e.target.value)}>
              {scale}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Ghi chú / dẫn chứng" className="mt-3">
        {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vd: hỗ trợ Duyên dựng video KN032 khi bạn ấy nghỉ ốm" />}
      </Field>
      {existing && (
        <p className="mt-3 text-[12.5px] text-ink-3">
          Lần sửa gần nhất: {updatedByName(existing.updated_by)} · {fmtVnDateTime(existing.updated_at, tz)}
        </p>
      )}
    </Modal>
  );
}
