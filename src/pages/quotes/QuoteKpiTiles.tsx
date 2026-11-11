import { ReactNode } from 'react';
import { BAND_LABEL, BandLevel, fmtNum, QuoteKpis } from '@/domain';
import { Icon } from '@/components/ui';
import type { SettingsRow } from '@/lib/settings';

export function KpiTile({ label, value, base, target, good, children }: { label: string; value: string; base?: string; target: string; good: boolean | null; children?: ReactNode }) {
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
    <div className="grid gap-3 md:grid-cols-3">
      <KpiTile
        label={`Tỷ lệ báo giá quá ${late} giờ`}
        value={k.latePct === null ? '–' : `${fmtNum(k.latePct, 1)}%`}
        base={`${fmtNum(base.quote_late_pct, 1)}%`}
        target={`≤ ${fmtNum(tgt.quote_late_pct, 0)}%`}
        good={k.latePct === null ? null : k.latePct <= tgt.quote_late_pct}
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
      >
        <div className="mt-1 border-t border-line pt-2 text-[13px] text-ink-2">
          Riêng báo giá trễ: <b className="text-ink">{k.lateAvgHours === null ? '–' : `${fmtNum(k.lateAvgHours, 2)} h`}</b>
          <span className="text-ink-3"> · baseline {fmtNum(base.quote_late_avg_hours ?? 10.7, 2)} h</span>
        </div>
      </KpiTile>
      <div className="rounded-xl bg-canvas p-4">
        <div className="text-[13px] font-semibold text-ink-2">Theo kết quả khung giá</div>
        <ul className="mt-2 flex flex-col gap-1.5 text-[14px]">
          {byBand.map((b) => (
            <li key={b.level} className="flex justify-between gap-2">
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
