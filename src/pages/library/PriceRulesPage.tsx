import { useEffect, useState } from 'react';
import { BAND_LABEL, BandLevel } from '@/domain';
import { Banner, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, useAsync, useToast } from '@/components/ui';
import { fmtVnDateTime } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';

interface RuleRow {
  level: BandLevel;
  max_discount_pct: number | null;
  max_deviation_pct: number | null;
  margin_floor_pct: number | null;
  updated_at: string;
}

type Form = Record<'send_now' | 'pm', { disc: string; dev: string; floor: string }>;

const toStr = (v: number | null) => (v === null || v === undefined ? '' : String(v));
const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function PriceRulesPage() {
  const toast = useToast();
  const { tz } = useSettings();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => check(await supabase.from('price_rules').select('level, max_discount_pct, max_deviation_pct, margin_floor_pct, updated_at')) as RuleRow[], []);

  useEffect(() => {
    if (!data) return;
    const get = (l: BandLevel) => data.find((r) => r.level === l);
    const f = (l: 'send_now' | 'pm') => ({ disc: toStr(get(l)?.max_discount_pct ?? null), dev: toStr(get(l)?.max_deviation_pct ?? null), floor: toStr(get(l)?.margin_floor_pct ?? null) });
    setForm({ send_now: f('send_now'), pm: f('pm') });
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!form) return null;

  const problems: string[] = [];
  for (const l of ['send_now', 'pm'] as const) {
    for (const [k, v] of Object.entries(form[l])) {
      const n = toNum(v);
      if (v.trim() !== '' && (n === null || Number.isNaN(n) || n < 0 || (k !== 'dev' && n > 100))) problems.push(`${BAND_LABEL[l]}: giá trị "${v}" không hợp lệ.`);
    }
  }
  const sd = toNum(form.send_now.disc);
  const pd = toNum(form.pm.disc);
  const sv = toNum(form.send_now.dev);
  const pv = toNum(form.pm.dev);
  if (sd !== null && pd !== null && sd > pd) problems.push('Chiết khấu "Gửi ngay" không nên lớn hơn mức PM được duyệt.');
  if (sv !== null && pv !== null && sv > pv) problems.push('Độ lệch giá "Gửi ngay" không nên lớn hơn mức PM được duyệt.');

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      for (const l of ['send_now', 'pm'] as const) {
        check(
          await supabase
            .from('price_rules')
            .update({ max_discount_pct: toNum(form[l].disc), max_deviation_pct: toNum(form[l].dev), margin_floor_pct: toNum(form[l].floor) })
            .eq('level', l),
        );
      }
      toast('Đã lưu luật khung giá. Áp dụng ngay cho mọi báo giá chưa gửi.');
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const set = (l: 'send_now' | 'pm', k: 'disc' | 'dev' | 'floor', v: string) => setForm((f) => (f ? { ...f, [l]: { ...f[l], [k]: v } } : f));
  const updated = data?.map((r) => r.updated_at).sort().at(-1);

  return (
    <div>
      <PageHeader title="Luật khung giá" subtitle="Chỉ CEO xem và sửa được trang này. Account chỉ thấy kết quả: Gửi ngay / Cần PM / Cần CEO." />
      <Banner tone="info" className="mb-4" title="Giá trị đang là mức tạm thời chờ CEO chốt">
        Mặc định: tự gửi nếu chiết khấu ≤ 10% và mọi đơn giá lệch ≤ ±10% so với thư viện; PM duyệt nếu ≤ 20%; còn lại CEO duyệt. Mọi thay đổi được ghi vào nhật ký (ai, lúc nào). Nếu đổi giữa pilot, ghi ngày đổi vào báo cáo.
      </Banner>
      <div className="grid gap-4 lg:grid-cols-3">
        {(['send_now', 'pm'] as const).map((l) => (
          <Card key={l} title={l === 'send_now' ? 'Account gửi ngay' : 'PM duyệt'} subtitle={l === 'send_now' ? 'Trong mức này thì không cần ai duyệt' : 'Vượt mức "gửi ngay" nhưng còn trong mức này'}>
            <div className="flex flex-col gap-3">
              <Field label="Chiết khấu tối đa (%)">{(id) => <Input id={id} inputMode="decimal" value={form[l].disc} onChange={(e) => set(l, 'disc', e.target.value)} />}</Field>
              <Field label="Đơn giá lệch thư viện tối đa (± %)" hint={l === 'send_now' ? 'Hạng mục có khung tự gửi riêng thì dùng khung đó' : undefined}>
                {(id) => <Input id={id} inputMode="decimal" value={form[l].dev} onChange={(e) => set(l, 'dev', e.target.value)} />}
              </Field>
              <Field label="Sàn tổng giá (% giá trị theo thư viện)" hint="Ví dụ 85: tổng sau chiết khấu phải ≥ 85% tổng tính theo giá thư viện. Để trống = tắt.">
                {(id) => <Input id={id} inputMode="decimal" value={form[l].floor} onChange={(e) => set(l, 'floor', e.target.value)} placeholder="tắt" />}
              </Field>
            </div>
          </Card>
        ))}
        <Card title="CEO duyệt" subtitle="Mọi báo giá vượt mức PM, hoặc có hạng mục ngoài thư viện">
          <p className="text-[15px] text-ink-2">Không có giới hạn trên. Báo giá cấp CEO không hiện trong hàng chờ của PM, và ngược lại.</p>
          <p className="mt-3 text-[13px] text-ink-3">
            Biên lợi nhuận theo giá vốn cần cột giá vốn trong thư viện; bản này dùng "sàn tổng giá" theo giá thư viện. Muốn tính theo giá vốn thì cần sửa PRD.
          </p>
        </Card>
      </div>
      {problems.length > 0 && (
        <ul className="mt-4 list-disc pl-5 text-sm text-bad">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {updated && <span className="text-[13px] text-ink-3">Cập nhật gần nhất: {fmtVnDateTime(updated, tz)}</span>}
        <Button busy={busy} disabled={problems.length > 0} onClick={save}>
          Lưu luật khung giá
        </Button>
      </div>
    </div>
  );
}
