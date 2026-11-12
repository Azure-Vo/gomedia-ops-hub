import { ReactNode } from 'react';
import { BAND_LABEL, BandLevel, fmtNum, QuoteKpis } from '@/domain';
import { Icon } from '@/components/ui';
import type { SettingsRow } from '@/lib/settings';

/** Baseline vs now on one scale, with the target as a tick: the before/after the pilot is judged on. */
export function BaselineBar({ base, now, target, good }: { base: number; now: number | null; target: number; good: boolean | null }) {
  const max = Math.max(base, now ?? 0, target) * 1.12 || 1;
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="mt-2 grid grid-cols-[58px_1fr] items-center gap-x-2 gap-y-1 text-[12px] text-ink-3" aria-hidden="true">
      <span>Baseline</span>
      <div className="relative h-[7px] rounded-[2px] bg-ink/[0.07]">
        <div className="absolute inset-y-0 left-0 rounded-[2px] bg-ink/25" style={{ width: pct(base) }} />
        <div className="absolute -inset-y-1 w-[2px] bg-ink" style={{ left: pct(target) }} />
      </div>
      <span className="font-medium text-ink-2">Hiện tại</span>
      <div className="relative h-[7px] rounded-[2px] bg-ink/[0.07]">
        {now !== null && <div className={`absolute inset-y-0 left-0 min-w-[3px] rounded-[2px] ${good === false ? 'bg-accent-strong' : 'bg-brand'}`} style={{ width: pct(now) }} />}
        <div className="absolute -inset-y-1 w-[2px] bg-ink" style={{ left: pct(target) }} />
      </div>
    </div>
  );
}

export function KpiTile({
  label,
  value,
  base,
  target,
  good,
  bar,
  children,
}: {
  label: string;
  value: string;
  base?: string;
  target?: string;
  good: boolean | null;
  bar?: { base: number; now: number | null; target: number };
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-t-2 border-ink pt-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-ink-2">{label}</div>
        {good !== null && (
          <div className={`inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold ${good ? 'text-ok-ink' : 'text-bad'}`}>
            <Icon name={good ? 'check' : 'x'} size={14} /> {good ? 'Đạt mục tiêu' : 'Chưa đạt'}
          </div>
        )}
      </div>
      <div className="text-[34px] font-semibold leading-none tracking-[-0.02em] text-ink">{value}</div>
      {bar && <BaselineBar base={bar.base} now={bar.now} target={bar.target} good={good} />}
      {(base || target) && (
        <div className="text-[13px] text-ink-3">
          {base && <>Baseline {base}</>}
          {base && target && ' · '}
          {target && <>Mục tiêu {target}</>}
        </div>
      )}
      {children}
    </div>
  );
}

export const DEFAULT_BASE: SettingsRow['kpi_baselines'] = { quote_avg_hours: 8.66, quote_late_pct: 52.6, quote_count: 19, task_overdue_pct: 55.2, quote_late_avg_hours: 10.7 };
export const DEFAULT_TARGET: SettingsRow['kpi_targets'] = { quote_avg_hours: 8, quote_late_pct: 30, response_rate: 90, early_warning: 85, overdue_pct: 20 };

/** The S2 quotation KPIs: late share, average turnaround (all quotes, and late ones only), and by band. */
export function QuoteKpiTiles({
  k,
  byBand,
  settings,
  note,
}: {
  k: QuoteKpis;
  byBand: { level: BandLevel; count: number; avgHours: number | null }[];
  settings: SettingsRow | null;
  note?: ReactNode;
}) {
  const late = settings?.quote_late_hours ?? 8;
  const base = { ...DEFAULT_BASE, ...(settings?.kpi_baselines ?? {}) };
  const tgt = settings?.kpi_targets ?? DEFAULT_TARGET;
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
      <KpiTile
        label={`Tỷ lệ báo giá quá ${late} giờ`}
        value={k.latePct === null ? '–' : `${fmtNum(k.latePct, 1)}%`}
        base={`${fmtNum(base.quote_late_pct, 1)}%`}
        target={`≤ ${fmtNum(tgt.quote_late_pct, 0)}%`}
        good={k.latePct === null ? null : k.latePct <= tgt.quote_late_pct}
        bar={{ base: base.quote_late_pct, now: k.latePct, target: tgt.quote_late_pct }}
      >
        <div className="text-[13px] text-ink-3">
          {k.lateCount}/{k.count} báo giá
        </div>
      </KpiTile>
      <KpiTile
        label="Thời gian báo giá trung bình"
        value={k.avgHours === null ? '–' : `${fmtNum(k.avgHours, 2)} h`}
        base={`${fmtNum(base.quote_avg_hours, 2)} h`}
        target={`< ${fmtNum(tgt.quote_avg_hours, 0)} h (CEO)`}
        good={k.avgHours === null ? null : k.avgHours < tgt.quote_avg_hours}
        bar={{ base: base.quote_avg_hours, now: k.avgHours, target: tgt.quote_avg_hours }}
      >
        <div className="mt-1 border-t border-line-soft pt-2 text-[13px] text-ink-2">
          Riêng báo giá trễ: <b className="text-ink">{k.lateAvgHours === null ? '–' : `${fmtNum(k.lateAvgHours, 2)} h`}</b>
          <span className="text-ink-3"> · baseline {fmtNum(base.quote_late_avg_hours ?? 10.7, 2)} h</span>
        </div>
      </KpiTile>
      <div className="border-t-2 border-ink pt-2.5">
        <div className="text-[13px] font-medium text-ink-2">Theo kết quả khung giá</div>
        <ul className="mt-2 flex flex-col text-[14px]">
          {byBand.map((b) => (
            <li key={b.level} className="flex justify-between gap-2 border-b border-line-soft py-1.5 last:border-0">
              <span>{BAND_LABEL[b.level]}</span>
              <span className="tabular-nums">
                {b.count} · {b.avgHours === null ? '–' : `${fmtNum(b.avgHours, 2)} h`}
              </span>
            </li>
          ))}
        </ul>
        {note}
      </div>
    </div>
  );
}
