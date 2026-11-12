import { useEffect, useState } from 'react';
import { fmtNum, validateCalendar, WorkCalendar, workingHoursBetween, at } from '@/domain';
import { Banner, Button, Card, Field, Input, Loading, PageHeader, useToast } from '@/components/ui';
import { SettingsRow, useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';

const DAYS = [
  [1, 'T2'],
  [2, 'T3'],
  [3, 'T4'],
  [4, 'T5'],
  [5, 'T6'],
  [6, 'T7'],
  [7, 'CN'],
] as const;

export function SettingsPage() {
  const { settings, reload } = useSettings();
  const toast = useToast();
  const [s, setS] = useState<SettingsRow | null>(settings);
  const [holiday, setHoliday] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(settings), [settings]);
  if (!s) return <Loading />;

  const cal: WorkCalendar = { timeZone: s.timezone, workDays: s.work_days, blocks: s.work_blocks, holidays: s.holidays.map(String) };
  const problems = validateCalendar(cal);
  let sample: string | null = null;
  try {
    sample = problems.length ? null : fmtNum(workingHoursBetween(at('Mon', '16:30'), at('Tue', '09:30'), cal), 2);
  } catch {
    sample = null;
  }

  async function save() {
    if (!s) return;
    setBusy(true);
    try {
      check(
        await supabase
          .from('settings')
          .update({
            timezone: s.timezone,
            work_days: s.work_days,
            work_blocks: s.work_blocks,
            holidays: s.holidays,
            no_reply_window_hours: Number(s.no_reply_window_hours),
            quote_late_hours: Number(s.quote_late_hours),
            library_review_months: Number(s.library_review_months),
            kpi_baselines: s.kpi_baselines,
            kpi_targets: s.kpi_targets,
            pilot_start: s.pilot_start || null,
            pilot_end: s.pilot_end || null,
            company_name: s.company_name,
            app_url: s.app_url || null,
            vat_pct: Math.min(100, Math.max(0, Number(s.vat_pct) || 0)),
            vat_on_pass_through: !!s.vat_on_pass_through,
            company_legal_name: s.company_legal_name.trim(),
            company_tax_code: s.company_tax_code.trim(),
            company_address: s.company_address.trim(),
            company_phone: s.company_phone.trim(),
            company_website: s.company_website.trim(),
            signer_name: s.signer_name.trim(),
            signer_title: s.signer_title.trim(),
          })
          .eq('id', 1),
      );
      toast('Đã lưu cài đặt');
      await reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const setBlock = (i: number, k: 'start' | 'end', v: string) => setS({ ...s, work_blocks: s.work_blocks.map((b, j) => (j === i ? { ...b, [k]: v } : b)) });
  const numField = (label: string, value: number, onChange: (n: number) => void, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => <Input id={id} inputMode="decimal" value={String(value)} onChange={(e) => onChange(Number(e.target.value.replace(',', '.')) || 0)} />}
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Cài đặt"
        subtitle="Mọi thời lượng trong app tính bằng giờ làm việc theo lịch này. Đổi lịch giữa pilot thì ghi ngày đổi vào báo cáo."
        actions={
          <Button busy={busy} disabled={problems.length > 0} onClick={save}>
            Lưu cài đặt
          </Button>
        }
      />
      {problems.length > 0 && <Banner tone="bad" title="Lịch giờ làm chưa hợp lệ">{problems.join(' ')}</Banner>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Lịch giờ làm việc" subtitle={sample ? `Kiểm tra nhanh: T2 16:30 → T3 09:30 = ${sample} giờ làm việc` : undefined}>
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1.5 text-[13px] font-semibold text-ink-2">Ngày làm việc</div>
              <div className="flex flex-wrap gap-2">
                {DAYS.map(([d, label]) => {
                  const on = s.work_days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setS({ ...s, work_days: on ? s.work_days.filter((x) => x !== d) : [...s.work_days, d].sort() })}
                      className={`h-11 w-12 rounded-lg border font-bold ${on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-2'}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[13px] font-semibold text-ink-2">Ca làm việc</div>
              <div className="flex flex-col gap-2">
                {s.work_blocks.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input aria-label={`Ca ${i + 1} bắt đầu`} type="time" value={b.start} onChange={(e) => setBlock(i, 'start', e.target.value)} className="w-32" />
                    <span>→</span>
                    <Input aria-label={`Ca ${i + 1} kết thúc`} type="time" value={b.end} onChange={(e) => setBlock(i, 'end', e.target.value)} className="w-32" />
                    {s.work_blocks.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => setS({ ...s, work_blocks: s.work_blocks.filter((_, j) => j !== i) })}>
                        Xoá ca
                      </Button>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon="plus" onClick={() => setS({ ...s, work_blocks: [...s.work_blocks, { start: '18:00', end: '19:00' }] })}>
                  Thêm ca
                </Button>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[13px] font-semibold text-ink-2">Ngày nghỉ lễ (không tính giờ làm)</div>
              <div className="flex flex-wrap gap-2">
                {s.holidays.map((h) => (
                  <button key={h} type="button" onClick={() => setS({ ...s, holidays: s.holidays.filter((x) => x !== h) })} className="min-h-[40px] rounded-full bg-canvas px-3 text-sm font-semibold text-ink-2 hover:bg-bad-soft" title="Bấm để xoá">
                    {String(h).split('-').reverse().join('/')} ✕
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Input aria-label="Thêm ngày nghỉ" type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} className="w-48" />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!holiday}
                  onClick={() => {
                    if (!s.holidays.includes(holiday)) setS({ ...s, holidays: [...s.holidays, holiday].sort() });
                    setHoliday('');
                  }}
                >
                  Thêm
                </Button>
              </div>
              <p className="mt-2 text-[13px] text-ink-3">Quốc khánh 2026: nghỉ 2/9 và một ngày liền kề (1/9 hoặc 3/9) do công ty chọn. Hỏi Go Media rồi thêm ngày đó nếu cần.</p>
            </div>
            <Field label="Múi giờ">{(id) => <Input id={id} value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />}</Field>
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Quy tắc">
            <div className="grid gap-3 sm:grid-cols-2">
              {numField('Báo giá trễ khi quá (giờ làm việc)', s.quote_late_hours, (n) => setS({ ...s, quote_late_hours: n }))}
              {numField('Cảnh báo im lặng sau (giờ làm việc)', s.no_reply_window_hours, (n) => setS({ ...s, no_reply_window_hours: n }))}
              {numField('Nhắc rà soát giá sau (tháng)', s.library_review_months, (n) => setS({ ...s, library_review_months: Math.max(1, Math.round(n)) }))}
              <Field label="Địa chỉ web app" hint="Dùng cho nút mở app trong tin nhắn Telegram">
                {(id) => (
                  <div className="flex gap-2">
                    <Input id={id} value={s.app_url ?? ''} onChange={(e) => setS({ ...s, app_url: e.target.value })} placeholder="https://…" />
                    <Button size="sm" variant="ghost" onClick={() => setS({ ...s, app_url: (window.location.origin + import.meta.env.BASE_URL).replace(/\/$/, '') })}>
                      Lấy địa chỉ này
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="Bot Telegram">{(id) => <Input id={id} disabled value={s.telegram_bot_username ? `@${s.telegram_bot_username}` : 'chưa kết nối (xem Diagnostics)'} />}</Field>
            </div>
          </Card>
          <Card title="Báo giá: công ty và thuế" subtitle="In trên PDF báo giá theo mẫu Go Media. Đổi thuế suất chỉ áp cho báo giá tạo sau đó.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tên ngắn (chữ ký: ĐẠI DIỆN …)">{(id) => <Input id={id} value={s.company_name} onChange={(e) => setS({ ...s, company_name: e.target.value })} />}</Field>
              <Field label="Tên pháp lý (đầu trang)">{(id) => <Input id={id} value={s.company_legal_name} onChange={(e) => setS({ ...s, company_legal_name: e.target.value })} />}</Field>
              <Field label="Mã số thuế">{(id) => <Input id={id} value={s.company_tax_code} onChange={(e) => setS({ ...s, company_tax_code: e.target.value })} />}</Field>
              <Field label="Địa chỉ">{(id) => <Input id={id} value={s.company_address} onChange={(e) => setS({ ...s, company_address: e.target.value })} />}</Field>
              <Field label="Website">{(id) => <Input id={id} value={s.company_website} onChange={(e) => setS({ ...s, company_website: e.target.value })} />}</Field>
              <Field label="Điện thoại">{(id) => <Input id={id} value={s.company_phone} onChange={(e) => setS({ ...s, company_phone: e.target.value })} />}</Field>
              <Field label="Người ký">{(id) => <Input id={id} value={s.signer_name} onChange={(e) => setS({ ...s, signer_name: e.target.value })} />}</Field>
              <Field label="Chức vụ người ký">{(id) => <Input id={id} value={s.signer_title} onChange={(e) => setS({ ...s, signer_title: e.target.value })} />}</Field>
              {numField('Thuế GTGT mặc định (%)', s.vat_pct, (n) => setS({ ...s, vat_pct: n }), 'Mức 8% là mức giảm tạm thời; hỏi kế toán khi chính sách đổi')}
              <label className="flex min-h-[44px] items-center gap-2 self-end text-[14px] text-ink-2">
                <input type="checkbox" className="h-5 w-5" checked={s.vat_on_pass_through} onChange={(e) => setS({ ...s, vat_on_pass_through: e.target.checked })} /> Tính VAT cả trên khoản chi hộ
              </label>
            </div>
          </Card>
          <Card title="Pilot và mục tiêu" subtitle="Dashboard mặc định hiển thị khoảng pilot. Mục tiêu đang là đề xuất của nhóm, chờ CEO xác nhận.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Pilot bắt đầu">{(id) => <Input id={id} type="date" value={s.pilot_start ?? ''} onChange={(e) => setS({ ...s, pilot_start: e.target.value || null })} />}</Field>
              <Field label="Pilot kết thúc">{(id) => <Input id={id} type="date" value={s.pilot_end ?? ''} onChange={(e) => setS({ ...s, pilot_end: e.target.value || null })} />}</Field>
              {numField('Baseline: báo giá TB (giờ)', s.kpi_baselines.quote_avg_hours, (n) => setS({ ...s, kpi_baselines: { ...s.kpi_baselines, quote_avg_hours: n } }))}
              {numField('Baseline: TB riêng báo giá trễ (giờ)', s.kpi_baselines.quote_late_avg_hours ?? 10.7, (n) => setS({ ...s, kpi_baselines: { ...s.kpi_baselines, quote_late_avg_hours: n } }))}
              {numField('Mục tiêu: báo giá TB < (giờ)', s.kpi_targets.quote_avg_hours, (n) => setS({ ...s, kpi_targets: { ...s.kpi_targets, quote_avg_hours: n } }))}
              {numField('Baseline: % báo giá trễ', s.kpi_baselines.quote_late_pct, (n) => setS({ ...s, kpi_baselines: { ...s.kpi_baselines, quote_late_pct: n } }))}
              {numField('Mục tiêu: % báo giá trễ ≤', s.kpi_targets.quote_late_pct, (n) => setS({ ...s, kpi_targets: { ...s.kpi_targets, quote_late_pct: n } }))}
              {numField('Baseline: % task trễ', s.kpi_baselines.task_overdue_pct, (n) => setS({ ...s, kpi_baselines: { ...s.kpi_baselines, task_overdue_pct: n } }))}
              {numField('Mục tiêu: % task trễ <', s.kpi_targets.overdue_pct, (n) => setS({ ...s, kpi_targets: { ...s.kpi_targets, overdue_pct: n } }))}
              {numField('Mục tiêu: % trả lời checkpoint ≥', s.kpi_targets.response_rate, (n) => setS({ ...s, kpi_targets: { ...s.kpi_targets, response_rate: n } }))}
              {numField('Mục tiêu: % cảnh báo sớm ≥', s.kpi_targets.early_warning, (n) => setS({ ...s, kpi_targets: { ...s.kpi_targets, early_warning: n } }))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
