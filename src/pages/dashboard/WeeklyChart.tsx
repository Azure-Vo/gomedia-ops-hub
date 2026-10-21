import { useEffect, useRef, useState } from 'react';
import type { WeeklyPoint } from '@/domain';
import { fmtNum } from '@/lib/format';

const H = 240;

/** Even ticks (step 1/2/5 × 10^n, at most 6 intervals) so the axis reads 0, 2, 4, 6, 8, 10. */
function niceScale(v: number): { max: number; step: number } {
  const target = Math.max(v * 1.1, 1);
  const mag = 10 ** Math.floor(Math.log10(target / 6));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => Math.ceil(target / s) <= 6) ?? 10 * mag;
  return { max: Math.ceil(target / step) * step, step };
}

function weekLabel(d: string): string {
  const [, m, day] = d.split('-');
  return `${day}/${m}`;
}

/**
 * Weekly average quote turnaround (one series, so no legend box: the card title names it and its unit),
 * with the baseline and the target as labelled reference lines. Drawn at the container's pixel width so
 * text stays 12px on every screen. Hover or keyboard focus shows the week's numbers.
 */
export function WeeklyChart({ points, baseline, target, lateHours }: { points: WeeklyPoint[]; baseline: number; target: number; lateHours: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = W < 520;
  const PAD = { l: 36, r: narrow ? 12 : 132, t: 14, b: 30 };
  const { max, step } = niceScale(Math.max(baseline, lateHours, ...points.map((p) => p.avgHours)));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length <= 1 ? innerW / 2 : (i * innerW) / (points.length - 1));
  const y = (v: number) => PAD.t + innerH - (v / max) * innerH;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.avgHours).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(innerW / 56))));
  const slot = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const hp = hover !== null ? points[hover] : null;
  const last = points.length ? points[points.length - 1] : null;
  const refs = [
    { v: baseline, label: `Baseline ${fmtNum(baseline, 2)} h`, color: '#5D5B80', dash: '6 4' },
    { v: target, label: `Mục tiêu ≤ ${fmtNum(target, 2)} h`, color: '#C2410C', dash: '2 4' },
  ];

  return (
    <div ref={box} className="relative w-full">
      <svg width={W} height={H} className="block" role="img" aria-label="Thời gian báo giá trung bình theo tuần, so với baseline và mục tiêu">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#ECEAF3" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="#5D5B80" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {fmtNum(t, 0)}
            </text>
          </g>
        ))}
        {refs.map((r) => (
          <g key={r.label}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(r.v)} y2={y(r.v)} stroke={r.color} strokeWidth={1.5} strokeDasharray={r.dash} />
            {narrow ? (
              <text x={W - PAD.r} y={y(r.v) - 6} textAnchor="end" fontSize={12} fill="#4A4870" fontWeight={600}>
                {r.label}
              </text>
            ) : (
              <text x={W - PAD.r + 8} y={y(r.v) + 4} fontSize={12} fill="#4A4870" fontWeight={600}>
                {r.label}
              </text>
            )}
          </g>
        ))}
        {points.length > 1 && <path d={path} fill="none" stroke="#1800AD" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
        {hp && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + innerH} stroke="#A99BF0" strokeWidth={1} />}
        {points.map((p, i) => (
          <g key={p.weekStart}>
            <circle cx={x(i)} cy={y(p.avgHours)} r={hover === i ? 6 : 4.5} fill="#1800AD" stroke="#FFFFFF" strokeWidth={2} />
            {(i % labelEvery === 0 || i === points.length - 1) && (
              <text x={x(i)} y={H - PAD.b + 18} textAnchor="middle" fontSize={12} fill="#5D5B80">
                {weekLabel(p.weekStart)}
              </text>
            )}
          </g>
        ))}
        {last && (
          <text x={x(points.length - 1) + (points.length > 1 ? -8 : 0)} y={y(last.avgHours) - 12} textAnchor={points.length > 1 ? 'end' : 'middle'} fontSize={12} fontWeight={700} fill="#24224F">
            {fmtNum(last.avgHours, 2)} h
          </text>
        )}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.weekStart}`}
            x={x(i) - slot / 2}
            y={PAD.t}
            width={slot}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            aria-label={`Tuần ${weekLabel(p.weekStart)}: trung bình ${fmtNum(p.avgHours, 2)} giờ, ${p.count} báo giá`}
          />
        ))}
      </svg>
      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute rounded-lg bg-ink px-3 py-2 text-[13px] text-white shadow-lg"
          style={{ left: x(hover), top: 8, transform: x(hover) > W * 0.6 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}
        >
          <div className="font-bold">Tuần {weekLabel(hp.weekStart)}</div>
          <div>Trung bình: {fmtNum(hp.avgHours, 2)} giờ</div>
          <div>
            {hp.count} báo giá · {fmtNum(hp.latePct, 0)}% quá {lateHours} giờ
          </div>
        </div>
      )}
    </div>
  );
}
