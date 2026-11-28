// 1.8 · Hành trình báo giá: thời gian từng chặng và số vòng sửa theo từng Account (CEO, consult 27/11).
// KPI chính không đổi: gửi khách trong ≤ quote_late_hours (8) giờ làm việc.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  accountJourneys,
  fmtNum,
  Grade,
  GRADE_LABEL,
  GradeScale,
  JourneyQuote,
  JourneyRow,
  JourneyStage,
  KPI_STAGES,
  localToMs,
  quoteJourney,
  STAGE_LABEL,
  STAGE_OWNER,
  teamStageShare,
} from '@/domain';
import { Badge, Button, Card, cx, ErrorBox, Field, Icon, Input, Loading, PageHeader, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnDateTime, toDateInput } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { supabase } from '@/lib/supabase';

export const STAGE_COLOR: Record<JourneyStage, string> = {
  draft: '#4E79D9',
  fix: '#E08A2E',
  review: '#8C63D2',
  sign: '#A64D79',
  send: '#4E9F6B',
  client: '#9A9A94',
};
const GRADE_TONE: Record<Grade, 'ok' | 'neutral' | 'warn' | 'bad'> = { good: 'ok', fair: 'neutral', weak: 'warn', poor: 'bad' };
const OWNER_LABEL = { account: 'Account', manager: 'PM/CEO', client: 'Khách' } as const;

interface RawQuote {
  id: string;
  code: string;
  client: string;
  kind: string;
  status: string;
  account_id: string;
  account_name: string;
  requested_at: string;
  sent_at: string | null;
  client_signed_at: string | null;
  events: { action: string; at: string }[];
}

function dayStart(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return localToMs(y, m, d, 0, 0, tz);
}

/** Thanh chồng: giờ trung bình từng chặng, có vạch mục tiêu. */
function StageBar({ stages, max, target, height = 14 }: { stages: Partial<Record<JourneyStage, number>>; max: number; target: number; height?: number }) {
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="relative w-full rounded-[3px] bg-ink/[0.06]" style={{ height }}>
      <div className="absolute inset-0 flex overflow-hidden rounded-[3px]">
        {KPI_STAGES.map((st) =>
          (stages[st] ?? 0) > 0 ? <div key={st} title={`${STAGE_LABEL[st]}: ${fmtNum(stages[st]!, 1)} giờ`} style={{ width: pct(stages[st]!), background: STAGE_COLOR[st] }} /> : null,
        )}
      </div>
      <div className="absolute -inset-y-1 w-[2px] bg-ink" style={{ left: pct(target) }} title={`Mục tiêu ${target} giờ`} />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
      {KPI_STAGES.map((st) => (
        <span key={st} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: STAGE_COLOR[st] }} />
          {STAGE_LABEL[st]} <span className="text-ink-3">({OWNER_LABEL[STAGE_OWNER[st]]})</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-[2px] bg-ink" /> Mục tiêu
      </span>
    </div>
  );
}

export function QuoteJourneyPage() {
  const me = useProfile();
  const toast = useToast();
  const { settings, calendar, tz, reload } = useSettings();
  const target = settings?.quote_late_hours ?? 8;
  const goalPct = 100 - (settings?.kpi_targets?.quote_late_pct ?? 30);
  const scale: GradeScale = { good: target, fair: Number(settings?.quote_grade_fair_hours ?? 16), weak: Number(settings?.quote_grade_weak_hours ?? 24) };
  const defFrom = settings?.pilot_start ?? toDateInput(Date.now() - 34 * 86_400_000, tz);
  const defTo = toDateInput(Date.now(), tz);
  const [from, setFrom] = useState(defFrom);
  const [to, setTo] = useState(defTo);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setFrom(defFrom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defFrom]);
  const [focus, setFocus] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ fair: string; weak: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const range = useMemo(() => ({ a: new Date(dayStart(from, tz)).toISOString(), b: new Date(dayStart(to, tz) + 86_400_000).toISOString() }), [from, to, tz]);
  const { data, error, loading } = useAsync(async () => {
    const r = await supabase.rpc('ops_quote_journey', { p_from: range.a, p_to: range.b });
    if (r.error) throw new Error(r.error.message);
    return r.data as RawQuote[];
  }, [range.a, range.b]);

  const view = useMemo(() => {
    if (!data) return null;
    const rows: JourneyRow[] = data.map((q) =>
      quoteJourney(
        {
          id: q.id,
          code: q.code,
          client: q.client,
          accountId: q.account_id,
          accountName: q.account_name,
          requestedAt: Date.parse(q.requested_at),
          sentAt: q.sent_at ? Date.parse(q.sent_at) : null,
          clientSignedAt: q.client_signed_at ? Date.parse(q.client_signed_at) : null,
          events: q.events.map((e) => ({ action: e.action, at: Date.parse(e.at) })),
        } satisfies JourneyQuote,
        calendar,
        scale,
      ),
    );
    const sent = rows.filter((r) => r.kpiHours !== null);
    const accounts = accountJourneys(rows, scale);
    const team = teamStageShare(rows);
    const ok = sent.filter((r) => r.onTarget).length;
    const rounds = sent.reduce((s, r) => s + r.rounds, 0);
    const avg = sent.length ? sent.reduce((s, r) => s + r.kpiHours!, 0) / sent.length : null;
    const topStage = [...team].sort((a, b) => b.hours - a.hours)[0];
    const maxAvg = Math.max(target * 1.25, ...accounts.map((a) => KPI_STAGES.reduce((s, st) => s + a.avgStage[st], 0)));
    const maxRow = Math.max(target * 1.25, ...sent.map((r) => r.kpiHours!));
    return { rows, sent, accounts, team, ok, rounds, avg, topStage, maxAvg, maxRow, open: rows.filter((r) => r.kpiHours === null) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, calendar, scale.good, scale.fair, scale.weak]);

  async function saveScale() {
    if (!edit) return;
    setBusy(true);
    try {
      await callApi('quote.grade_scale', { fair: Number(edit.fair.replace(',', '.')), weak: Number(edit.weak.replace(',', '.')) });
      toast('Đã lưu thang đánh giá');
      setEdit(null);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const list = view ? (focus ? view.sent.filter((r) => r.quote.accountId === focus) : view.sent) : [];
  const best = view?.accounts[0];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hành trình báo giá"
        subtitle={`Từ lúc nhận yêu cầu đến lúc gửi khách, tách theo từng chặng và từng Account. Mục tiêu KPI: gửi khách trong ≤ ${fmtNum(target, 0)} giờ làm việc.`}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Từ ngày">{(id) => <Input id={id} type="date" value={from} onChange={(e) => (setTouched(true), setFrom(e.target.value))} />}</Field>
        <Field label="Đến ngày">{(id) => <Input id={id} type="date" value={to} onChange={(e) => (setTouched(true), setTo(e.target.value))} />}</Field>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <span className="font-semibold">Thang đánh giá:</span>
          {(['good', 'fair', 'weak', 'poor'] as Grade[]).map((g) => (
            <Badge key={g} tone={GRADE_TONE[g]}>
              {GRADE_LABEL[g]} {g === 'good' ? `≤ ${fmtNum(scale.good, 0)}h` : g === 'fair' ? `≤ ${fmtNum(scale.fair, 0)}h` : g === 'weak' ? `≤ ${fmtNum(scale.weak, 0)}h` : `> ${fmtNum(scale.weak, 0)}h`}
            </Badge>
          ))}
          {(me.role === 'ceo' || me.role === 'admin') && !edit && (
            <Button variant="ghost" size="sm" icon="edit" onClick={() => setEdit({ fair: String(scale.fair), weak: String(scale.weak) })}>
              Chỉnh
            </Button>
          )}
        </div>
      </div>
      {edit && (
        <Card title="Chỉnh thang đánh giá" subtitle={`Mức Tốt = mục tiêu KPI (${fmtNum(scale.good, 0)} giờ, Admin → Cài đặt). Chủ doanh nghiệp đặt hai ngưỡng còn lại.`}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Trung bình đến (giờ)">{(id) => <Input id={id} inputMode="decimal" value={edit.fair} onChange={(e) => setEdit({ ...edit, fair: e.target.value })} />}</Field>
            <Field label="Yếu đến (giờ), quá mức này là Kém">{(id) => <Input id={id} inputMode="decimal" value={edit.weak} onChange={(e) => setEdit({ ...edit, weak: e.target.value })} />}</Field>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Huỷ
            </Button>
            <Button icon="check" busy={busy} onClick={saveScale}>
              Lưu
            </Button>
          </div>
        </Card>
      )}

      {error ? <ErrorBox error={error} /> : loading || !view ? <Loading label="Đang tính hành trình…" /> : !view.sent.length ? (
        <Card title="Chưa có báo giá đã gửi trong kỳ này">Chọn khoảng ngày khác.</Card>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Báo giá đã gửi khách" value={String(view.sent.length)} sub={view.open.length ? `${view.open.length} báo giá còn đang làm` : undefined} />
            <Tile
              label={`Đạt mục tiêu ≤ ${fmtNum(target, 0)} giờ`}
              value={`${fmtNum((view.ok * 100) / view.sent.length, 1)}%`}
              sub={`${view.ok}/${view.sent.length} báo giá · KPI ≥ ${fmtNum(goalPct, 0)}%`}
              good={(view.ok * 100) / view.sent.length >= goalPct}
            />
            <Tile label="Giờ làm việc trung bình" value={`${fmtNum(view.avg, 2)} giờ`} sub={view.avg !== null ? `Xếp loại ${GRADE_LABEL[view.avg <= scale.good ? 'good' : view.avg <= scale.fair ? 'fair' : view.avg <= scale.weak ? 'weak' : 'poor']}` : undefined} />
            <Tile label="Vòng sửa trung bình" value={fmtNum(view.rounds / view.sent.length, 2)} sub={`${view.rounds} lần PM/CEO yêu cầu sửa`} />
          </div>

          <Card
            title="Xếp hạng Account"
            subtitle="Xếp theo tỉ lệ đạt mục tiêu, rồi giờ trung bình, rồi số vòng sửa. Thanh màu là giờ trung bình mỗi chặng trên một báo giá."
            info="Chặng của Account: soạn, sửa theo góp ý, chốt và gửi. Chặng của quản lý: chờ PM/CEO duyệt, chờ CEO ký. Nếu chặng chậm nhất là chặng của quản lý thì việc cần cải thiện nằm ở khâu duyệt, không phải ở Account."
          >
            <Legend />
            <div className="mt-4 flex flex-col divide-y divide-line-soft">
              {view.accounts.map((a) => (
                <button
                  key={a.accountId}
                  type="button"
                  onClick={() => setFocus(focus === a.accountId ? null : a.accountId)}
                  className={cx('grid grid-cols-1 gap-3 py-3.5 text-left md:grid-cols-[minmax(170px,1.1fr)_2fr_minmax(220px,1.2fr)] md:items-center', focus === a.accountId && 'bg-brand-soft/40')}
                >
                  <div className="flex items-center gap-3">
                    <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold', a.rank === 1 ? 'bg-ink text-white' : 'border border-line-edge text-ink-2')}>
                      {a.rank === 1 ? <Icon name="trophy" size={16} /> : a.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[15.5px] font-semibold text-ink">{a.accountName}</div>
                      <div className="text-[13px] text-ink-3">{a.sent} báo giá đã gửi</div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <StageBar stages={a.avgStage} max={view.maxAvg} target={target} />
                    <div className="flex flex-wrap gap-x-3 text-[12.5px] text-ink-3">
                      {KPI_STAGES.filter((st) => a.avgStage[st] > 0.005).map((st) => (
                        <span key={st}>
                          <span className="mr-1 inline-block h-2 w-2 rounded-[2px]" style={{ background: STAGE_COLOR[st] }} />
                          {fmtNum(a.avgStage[st], 1)}h
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[13px]">
                    <Stat label="Đạt mục tiêu" value={`${fmtNum(a.onTargetPct, 0)}%`} tone={(a.onTargetPct ?? 0) >= goalPct ? 'ok' : 'bad'} />
                    <Stat label="Giờ TB" value={fmtNum(a.avgHours, 1)} badge={a.grade ? <Badge tone={GRADE_TONE[a.grade]}>{GRADE_LABEL[a.grade]}</Badge> : null} />
                    <Stat label="Vòng sửa TB" value={fmtNum(a.avgRounds, 1)} />
                    <div className="col-span-3 text-[13px] text-ink-2">
                      Chậm nhất: <b style={{ color: a.slowest ? STAGE_COLOR[a.slowest] : undefined }}>{a.slowest ? STAGE_LABEL[a.slowest] : '—'}</b>
                      {a.slowest && <span className="text-ink-3"> ({fmtNum(a.stageShare[a.slowest], 0)}% thời gian, khâu của {OWNER_LABEL[STAGE_OWNER[a.slowest]]})</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {best && (
              <p className="mt-3 border-t border-line pt-3 text-[14px] text-ink-2">
                <b>{best.accountName}</b> đang làm tốt nhất: {fmtNum(best.onTargetPct, 0)}% báo giá đạt mục tiêu, trung bình {fmtNum(best.avgHours, 1)} giờ.
                {view.topStage && view.topStage.hours > 0 && (
                  <>
                    {' '}Cả đội tốn nhiều giờ nhất ở chặng <b>{STAGE_LABEL[view.topStage.stage]}</b> ({fmtNum(view.topStage.pct, 0)}% tổng giờ).
                  </>
                )}
              </p>
            )}
          </Card>

          <div className="grid gap-5 xl:grid-cols-[1fr_1.6fr]">
            <Card title="Cả đội: giờ nằm ở chặng nào" subtitle="Tổng giờ làm việc của mọi báo giá đã gửi, chia theo chặng.">
              <div className="flex flex-col gap-3">
                {[...view.team].sort((a, b) => b.hours - a.hours).map((s) => (
                  <div key={s.stage} className="grid grid-cols-[150px_1fr_74px] items-center gap-3 text-[13.5px]">
                    <span className="text-ink-2">{STAGE_LABEL[s.stage]}</span>
                    <div className="h-[10px] rounded-[2px] bg-ink/[0.06]">
                      <div className="h-full rounded-[2px]" style={{ width: `${s.pct}%`, background: STAGE_COLOR[s.stage] }} />
                    </div>
                    <span className="text-right tabular-nums text-ink">{fmtNum(s.pct, 0)}%</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-line pt-3">
                <div className="mb-2 text-[13px] font-semibold text-ink-2">Xếp loại từng báo giá theo Account</div>
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="text-left text-ink-3">
                      <th className="py-1 font-medium">Account</th>
                      {(['good', 'fair', 'weak', 'poor'] as Grade[]).map((g) => (
                        <th key={g} className="py-1 text-right font-medium">{GRADE_LABEL[g]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.accounts.map((a) => (
                      <tr key={a.accountId} className="border-t border-line-soft">
                        <td className="py-1.5">{a.accountName}</td>
                        {(['good', 'fair', 'weak', 'poor'] as Grade[]).map((g) => (
                          <td key={g} className={cx('py-1.5 text-right tabular-nums', a.gradeCount[g] > 0 && g !== 'good' && 'font-semibold text-bad', a.gradeCount[g] > 0 && g === 'good' && 'font-semibold text-ok-ink')}>
                            {a.gradeCount[g]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card
              title={focus ? `Báo giá của ${view.accounts.find((a) => a.accountId === focus)?.accountName}` : 'Từng báo giá'}
              subtitle="Bấm một Account ở bảng xếp hạng để lọc. Bấm mã để mở báo giá."
              actions={focus ? <Button variant="ghost" size="sm" onClick={() => setFocus(null)}>Xem tất cả</Button> : undefined}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[13.5px]">
                  <thead>
                    <tr className="text-left text-ink-3">
                      <th className="py-1.5 font-medium">Báo giá</th>
                      {!focus && <th className="py-1.5 font-medium">Account</th>}
                      <th className="w-[34%] py-1.5 font-medium">Các chặng</th>
                      <th className="py-1.5 text-right font-medium">Giờ</th>
                      <th className="py-1.5 text-right font-medium">Vòng sửa</th>
                      <th className="py-1.5 text-right font-medium">Xếp loại</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...list].sort((a, b) => (b.quote.sentAt ?? 0) - (a.quote.sentAt ?? 0)).map((r) => (
                      <tr key={r.quote.id} className="border-t border-line-soft align-middle">
                        <td className="py-2 pr-2">
                          <Link to={`/quotes/${r.quote.id}`} className="font-semibold text-brand underline-offset-2 hover:underline">
                            {r.quote.code}
                          </Link>
                          <div className="max-w-[180px] truncate text-[12.5px] text-ink-3">{r.quote.client}</div>
                          <div className="text-[12px] text-ink-3">Gửi {r.quote.sentAt ? fmtVnDateTime(new Date(r.quote.sentAt).toISOString(), tz) : ''}</div>
                        </td>
                        {!focus && <td className="py-2 pr-2">{r.quote.accountName}</td>}
                        <td className="py-2 pr-3">
                          <StageBar stages={r.stageHours} max={view.maxRow} target={target} height={10} />
                          {r.slowest && <div className="mt-1 text-[12px] text-ink-3">Lâu nhất: {STAGE_LABEL[r.slowest]} {fmtNum(r.stageHours[r.slowest] ?? 0, 1)}h</div>}
                        </td>
                        <td className={cx('py-2 text-right tabular-nums font-semibold', r.onTarget ? 'text-ink' : 'text-bad')}>{fmtNum(r.kpiHours, 1)}</td>
                        <td className="py-2 text-right tabular-nums">{r.rounds}</td>
                        <td className="py-2 text-right">{r.grade && <Badge tone={GRADE_TONE[r.grade]}>{GRADE_LABEL[r.grade]}</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-t-2 border-ink pt-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-ink-2">{label}</div>
        {good !== undefined && (
          <div className={cx('inline-flex items-center gap-1 text-[12.5px] font-semibold', good ? 'text-ok-ink' : 'text-bad')}>
            <Icon name={good ? 'check' : 'x'} size={14} /> {good ? 'Đạt' : 'Chưa đạt'}
          </div>
        )}
      </div>
      <div className="text-[34px] font-semibold leading-none tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className="text-[13px] text-ink-3">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, tone, badge }: { label: string; value: string; tone?: 'ok' | 'bad'; badge?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={cx('flex items-center gap-1.5 text-[17px] font-semibold tabular-nums', tone === 'ok' ? 'text-ok-ink' : tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {value}
        {badge}
      </div>
    </div>
  );
}
