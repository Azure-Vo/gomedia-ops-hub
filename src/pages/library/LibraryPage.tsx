import { useMemo, useState } from 'react';
import { fmtNum, LINE_KIND_LABEL, LineKind, validateLibraryRows } from '@/domain';
import { Badge, Banner, Button, Card, EmptyState, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Textarea, useAsync, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { downloadText, parseCsv, readFileText, toCsv } from '@/lib/csv';
import { fmtVnd, fmtVnDate, fmtVnLong, toDateInput } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { LibraryItem, loadLibrary, loadTerms, QuoteTerm } from '../quotes/data';

const EMPTY = { id: '', code: '', name: '', unit: '', service_group: '', unit_price: '', band_low: '', band_high: '', description: '', kind: 'service' as LineKind };
type Draft = typeof EMPTY;

function monthsAgo(dateStr: string, months: number): boolean {
  const d = new Date(dateStr);
  const limit = new Date();
  limit.setMonth(limit.getMonth() - months);
  return d < limit;
}

const num = (s: string) => (s.replace(/\D/g, '') ? Number(s.replace(/\D/g, '')) : null);

export function LibraryPage() {
  const me = useProfile();
  const { settings, tz } = useSettings();
  const toast = useToast();
  const [showRetired, setShowRetired] = useState(false);
  const [text, setText] = useState('');
  const [group, setGroup] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data, error, loading, reload } = useAsync(() => loadLibrary(true), []);
  const reviewMonths = settings?.library_review_months ?? 3;

  const groups = useMemo(() => [...new Set((data ?? []).map((i) => i.service_group))].sort(), [data]);
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (data ?? []).filter((i) => (showRetired || i.active) && (!group || i.service_group === group) && (!t || `${i.name} ${i.code ?? ''}`.toLowerCase().includes(t)));
  }, [data, text, group, showRetired]);
  const stale = (data ?? []).filter((i) => i.active && monthsAgo(i.last_reviewed_at, reviewMonths)).length;

  async function saveItem() {
    if (!edit) return;
    const price = num(edit.unit_price);
    if (!edit.name.trim() || !edit.unit.trim() || !edit.service_group.trim() || price === null) {
      toast('Nhập đủ tên, đơn vị, nhóm dịch vụ và đơn giá.', 'bad');
      return;
    }
    const low = num(edit.band_low);
    const high = num(edit.band_high);
    if ((low !== null && low > price) || (high !== null && high < price)) {
      toast('Khung tự gửi phải bao quanh đơn giá (thấp ≤ đơn giá ≤ cao).', 'bad');
      return;
    }
    setBusy(true);
    try {
      const old = (data ?? []).find((i) => i.id === edit.id);
      const row = {
        code: edit.code.trim() || null,
        name: edit.name.trim(),
        unit: edit.unit.trim(),
        service_group: edit.service_group.trim(),
        unit_price: price,
        band_low: low,
        band_high: high,
        description: edit.description.trim() || null,
        kind: edit.kind,
        ...(old && old.unit_price === price ? {} : { last_reviewed_at: toDateInput(Date.now(), tz) }),
      };
      if (edit.id) check(await supabase.from('library_items').update(row).eq('id', edit.id));
      else check(await supabase.from('library_items').insert(row));
      toast(edit.id ? 'Đã cập nhật hạng mục' : 'Đã thêm hạng mục');
      setEdit(null);
      reload();
    } catch (e) {
      const m = (e as Error).message;
      toast(/library_name_unit|duplicate/.test(m) ? 'Đã có hạng mục cùng tên và đơn vị.' : m, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function markReviewed(i: LibraryItem) {
    try {
      check(await supabase.from('library_items').update({ last_reviewed_at: toDateInput(Date.now(), tz) }).eq('id', i.id));
      toast(`Đã đánh dấu rà soát: ${i.name}`);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function toggleActive(i: LibraryItem) {
    try {
      check(await supabase.from('library_items').update({ active: !i.active }).eq('id', i.id));
      toast(i.active ? `Đã ngừng dùng: ${i.name}` : `Đã dùng lại: ${i.name}`);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  const canHistory = me.role === 'pm' || me.role === 'admin';
  return (
    <div>
      <PageHeader
        title="Thư viện giá"
        subtitle={`Nguồn giá chuẩn duy nhất cho Quotation Builder. Hạng mục chưa rà soát quá ${reviewMonths} tháng được đánh dấu.`}
        actions={
          <>
            {canHistory && (
              <Button variant="secondary" icon="upload" onClick={() => setHistoryOpen(true)}>
                Nhập báo giá lịch sử
              </Button>
            )}
            <Button variant="secondary" icon="upload" onClick={() => setImportOpen(true)}>
              Nhập CSV thư viện
            </Button>
            <Button icon="plus" onClick={() => setEdit({ ...EMPTY })}>
              Thêm hạng mục
            </Button>
          </>
        }
      />
      {stale > 0 && (
        <Banner tone="warn" className="mb-4" title={`${stale} hạng mục cần rà soát giá`}>
          Giá chưa được xác nhận lại trong {reviewMonths} tháng. Kiểm tra rồi bấm "Đã rà soát" (hoặc sửa giá).
        </Banner>
      )}
      <Card
        title={`${rows.length} hạng mục`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Tìm hạng mục" placeholder="Tìm hạng mục…" value={text} onChange={(e) => setText(e.target.value)} className="w-56" />
            <Select aria-label="Nhóm dịch vụ" value={group} onChange={(e) => setGroup(e.target.value)} className="w-48">
              <option value="">Mọi nhóm</option>
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} className="h-5 w-5" /> Hiện mục đã ngừng
            </label>
          </div>
        }
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !rows.length ? (
          <EmptyState title="Thư viện đang trống" action={<Button icon="upload" onClick={() => setImportOpen(true)}>Nhập file CSV đã chuẩn bị ở Bước 0</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[14.5px]">
              <thead className="text-[13px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Hạng mục</th>
                  <th className="py-2 pr-3 font-semibold">Nhóm</th>
                  <th className="py-2 pr-3 font-semibold">Đơn vị</th>
                  <th className="py-2 pr-3 text-right font-semibold">Đơn giá</th>
                  <th className="py-2 pr-3 text-right font-semibold">Khung tự gửi</th>
                  <th className="py-2 pr-3 font-semibold">Rà soát</th>
                  <th className="py-2 font-semibold">
                    <span className="sr-only">Thao tác</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const old = monthsAgo(i.last_reviewed_at, reviewMonths);
                  return (
                    <tr key={i.id} className={`border-b border-line-soft ${i.active ? '' : 'opacity-60'}`}>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold">
                          {i.name} {i.kind === 'pass_through' && <Badge tone="brand">Chi hộ</Badge>}
                        </div>
                        {i.description && <div className="text-[12.5px] italic text-ink-3">{i.description}</div>}
                        {i.code && <div className="text-[12px] text-ink-3">{i.code}</div>}
                      </td>
                      <td className="py-2.5 pr-3">{i.service_group}</td>
                      <td className="py-2.5 pr-3">{i.unit}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{fmtVnd(i.unit_price)}</td>
                      <td className="py-2.5 pr-3 text-right text-ink-2 tabular-nums">
                        {i.band_low !== null || i.band_high !== null ? `${fmtVnd(i.band_low, false)} – ${fmtVnd(i.band_high, false)}` : <span className="text-ink-3">theo luật chung</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        {fmtVnDate(i.last_reviewed_at, tz)} {old && i.active && <Badge tone="warn">Cần rà soát</Badge>}
                        {!i.active && <Badge>Đã ngừng</Badge>}
                      </td>
                      <td className="py-1.5">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit({ id: i.id, code: i.code ?? '', name: i.name, unit: i.unit, service_group: i.service_group, unit_price: String(i.unit_price), band_low: i.band_low === null ? '' : String(i.band_low), band_high: i.band_high === null ? '' : String(i.band_high), description: i.description ?? '', kind: i.kind })}>
                            Sửa
                          </Button>
                          {i.active && (
                            <Button size="sm" variant="ghost" icon="check" onClick={() => markReviewed(i)}>
                              Đã rà soát
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => toggleActive(i)}>
                            {i.active ? 'Ngừng dùng' : 'Dùng lại'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Sửa hạng mục' : 'Thêm hạng mục'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Huỷ
            </Button>
            <Button busy={busy} onClick={saveItem}>
              Lưu
            </Button>
          </>
        }
      >
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tên hạng mục" className="sm:col-span-2">{(id) => <Input id={id} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
            <Field label="Đơn vị">{(id) => <Input id={id} value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="video, bài, tháng…" />}</Field>
            <Field label="Nhóm dịch vụ">
              {(id) => (
                <>
                  <Input id={id} list="groups" value={edit.service_group} onChange={(e) => setEdit({ ...edit, service_group: e.target.value })} />
                  <datalist id="groups">
                    {groups.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Đơn giá (đ)" hint="Đổi giá sẽ tự đánh dấu đã rà soát hôm nay">
              {(id) => <Input id={id} inputMode="numeric" value={edit.unit_price ? fmtVnd(num(edit.unit_price), false) : ''} onChange={(e) => setEdit({ ...edit, unit_price: e.target.value })} />}
            </Field>
            <Field label="Mã hạng mục (không bắt buộc)">{(id) => <Input id={id} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="SOC-TT-01" />}</Field>
            <Field label="Khung tự gửi: thấp nhất (đ)" hint="Để trống = theo luật chung của CEO">
              {(id) => <Input id={id} inputMode="numeric" value={edit.band_low ? fmtVnd(num(edit.band_low), false) : ''} onChange={(e) => setEdit({ ...edit, band_low: e.target.value })} />}
            </Field>
            <Field label="Khung tự gửi: cao nhất (đ)">
              {(id) => <Input id={id} inputMode="numeric" value={edit.band_high ? fmtVnd(num(edit.band_high), false) : ''} onChange={(e) => setEdit({ ...edit, band_high: e.target.value })} />}
            </Field>
            <Field label="Loại" hint="Chi hộ = tiền trả hộ khách (VD ngân sách quảng cáo): không chiết khấu, không xét khung giá, không tính VAT (trừ khi Admin bật)">
              {(id) => (
                <Select id={id} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as LineKind })}>
                  <option value="service">{LINE_KIND_LABEL.service}</option>
                  <option value="pass_through">{LINE_KIND_LABEL.pass_through}</option>
                </Select>
              )}
            </Field>
            <Field label="Mô tả phạm vi mặc định" hint="In nghiêng dưới tên hạng mục trên báo giá; Account sửa được từng báo giá" className="sm:col-span-2">
              {(id) => <Textarea id={id} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="VD: Chụp toàn bộ chương trình, bàn giao ảnh đã chỉnh màu" className="min-h-[64px]" />}
            </Field>
          </div>
        )}
      </Modal>
      <TermsCard canEdit={['pm', 'ceo', 'admin'].includes(me.role)} />
      <LibraryImport open={importOpen} onClose={() => setImportOpen(false)} existing={data ?? []} onDone={reload} />
      {canHistory && <HistoryImport open={historyOpen} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function LibraryImport({ open, onClose, existing, onDone }: { open: boolean; onClose: () => void; existing: LibraryItem[]; onDone: () => void }) {
  const toast = useToast();
  const { tz } = useSettings();
  const [preview, setPreview] = useState<ReturnType<typeof validateLibraryRows> | null>(null);
  const [busy, setBusy] = useState(false);
  const key = (name: string, unit: string) => `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
  const byKey = new Map(existing.map((i) => [key(i.name, i.unit), i]));

  async function onFile(f: File | undefined) {
    if (!f) return;
    const { rows } = parseCsv(await readFileText(f));
    setPreview(validateLibraryRows(rows));
  }

  async function run() {
    if (!preview) return;
    setBusy(true);
    try {
      const today = toDateInput(Date.now(), tz);
      const fresh = preview.rows.filter((r) => !byKey.has(key(r.name, r.unit)));
      const updates = preview.rows.filter((r) => byKey.has(key(r.name, r.unit)));
      if (fresh.length) {
        check(await supabase.from('library_items').insert(fresh.map((r) => ({ code: r.code, name: r.name, unit: r.unit, service_group: r.serviceGroup, unit_price: r.unitPrice, band_low: r.bandLow, band_high: r.bandHigh, description: r.description, kind: r.kind, last_reviewed_at: today }))));
      }
      for (const r of updates) {
        const old = byKey.get(key(r.name, r.unit))!;
        check(await supabase.from('library_items').update({ service_group: r.serviceGroup, unit_price: r.unitPrice, band_low: r.bandLow, band_high: r.bandHigh, kind: r.kind, ...(r.description ? { description: r.description } : {}), last_reviewed_at: today, active: true }).eq('id', old.id));
      }
      toast(`Đã nhập ${fresh.length} hạng mục mới, cập nhật ${updates.length} hạng mục`);
      setPreview(null);
      onClose();
      onDone();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const template = () =>
    downloadText(
      'mau_thu_vien_gia.csv',
      toCsv(
        [
          { item_name: 'Gói flycam', unit: 'gói', group: 'Sự kiện & sản xuất', unit_price: 5000000, band_low: '', band_high: '', kind: 'Dịch vụ', description: 'Quay toàn cảnh từ trên cao' },
          { item_name: 'Ngân sách Meta Ads (chi hộ)', unit: 'tháng', group: 'Quảng cáo', unit_price: 16000000, band_low: '', band_high: '', kind: 'Chi hộ', description: '' },
        ],
        ['item_name', 'unit', 'group', 'unit_price', 'band_low', 'band_high', 'kind', 'description'],
      ),
    );

  return (
    <Modal
      open={open}
      wide
      onClose={() => {
        setPreview(null);
        onClose();
      }}
      title="Nhập Thư viện giá từ CSV"
      footer={
        <>
          <Button variant="ghost" icon="download" onClick={template}>
            Tải file mẫu
          </Button>
          <Button busy={busy} disabled={!preview?.rows.length} onClick={run}>
            Nhập {preview?.rows.length ?? 0} dòng hợp lệ
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">
        Cột: <code>item_name, unit, group, unit_price</code> (bắt buộc), <code>band_low, band_high, kind</code> (Dịch vụ / Chi hộ), <code>description</code> (mô tả phạm vi) không bắt buộc. Đơn giá là trung vị giá đã duyệt 6–12 tháng (Bước 0). Hạng mục trùng tên và đơn vị sẽ được cập nhật giá.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block min-h-[44px] w-full text-sm" />
      {preview && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="ok">{preview.rows.filter((r) => !byKey.has(key(r.name, r.unit))).length} mới</Badge>
            <Badge tone="brand">{preview.rows.filter((r) => byKey.has(key(r.name, r.unit))).length} cập nhật</Badge>
            <Badge tone={preview.errors.length ? 'bad' : 'neutral'}>{preview.errors.length} lỗi</Badge>
          </div>
          {preview.errors.length > 0 && (
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm text-bad">
              {preview.errors.map((e) => (
                <li key={e.row}>
                  Dòng {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {preview.rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-b border-line-soft">
                    <td className="py-1.5 pr-2">{r.name}</td>
                    <td className="py-1.5 pr-2 text-ink-3">{r.unit}</td>
                    <td className="py-1.5 pr-2 text-ink-3">{r.serviceGroup}</td>
                    <td className="py-1.5 text-right">{fmtVnd(r.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface HistoryPreview {
  quotes: number;
  lines: number;
  errors: { row: number; message: string }[];
  unmatchedItems: string[];
  range: { from: string; to: string } | null;
  sample: { code: string; requested_at: string; sent_at: string }[];
}

function HistoryImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { tz } = useSettings();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const parsed = parseCsv(await readFileText(f)).rows;
      setRows(parsed);
      const r = await callApi<{ preview: HistoryPreview }>('quote.import', { rows: parsed, dryRun: true });
      setPreview(r.preview);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await callApi<{ result: { inserted: number; skipped: string[] } }>('quote.import', { rows });
      toast(`Đã nhập ${r.result.inserted} báo giá lịch sử${r.result.skipped.length ? `, bỏ qua ${r.result.skipped.length} mã đã có` : ''}`);
      setRows(null);
      setPreview(null);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const template = () =>
    downloadText(
      'mau_bao_gia_lich_su.csv',
      toCsv(
        [
          { quote_code: 'H-2026-001', client_alias: 'Khách A01', service_group: 'Social Media', requested_at: '2026-07-03 09:00', sent_at: '2026-07-03 15:30', item_name: 'Video TikTok ngắn (≤ 60s)', unit: 'video', qty: 12, unit_price: 1500000, discount_pct: 5 },
          { quote_code: 'H-2026-001', client_alias: 'Khách A01', service_group: 'Social Media', requested_at: '2026-07-03 09:00', sent_at: '2026-07-03 15:30', item_name: 'Bài đăng Facebook (thiết kế + caption)', unit: 'bài', qty: 8, unit_price: 600000, discount_pct: 5 },
        ],
        ['quote_code', 'client_alias', 'service_group', 'requested_at', 'sent_at', 'item_name', 'unit', 'qty', 'unit_price', 'discount_pct'],
      ),
    );

  return (
    <Modal
      open={open}
      wide
      onClose={() => {
        setRows(null);
        setPreview(null);
        onClose();
      }}
      title="Nhập báo giá lịch sử (đã ẩn tên khách)"
      footer={
        <>
          <Button variant="ghost" icon="download" onClick={template}>
            Tải file mẫu
          </Button>
          <Button busy={busy} disabled={!preview?.quotes} onClick={run}>
            Nhập {preview?.quotes ?? 0} báo giá
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">
        Mỗi dòng là một hạng mục: <code>quote_code, client_alias, service_group, requested_at, sent_at, item_name, unit, qty, unit_price, discount_pct</code>. Thời gian theo giờ Việt Nam, nên ghi dạng <code>2026-07-03 09:00</code> (không nhầm ngày/tháng); dạng <code>03/07/2026 09:00</code> được hiểu là ngày/tháng/năm. Báo giá nhập vào thành Kho tham chiếu và dùng cho kiểm tra baseline; không tính vào KPI pilot.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block min-h-[44px] w-full text-sm" />
      {busy && !preview && <Loading label="Đang kiểm tra file…" />}
      {preview && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="ok">{preview.quotes} báo giá hợp lệ</Badge>
            <Badge tone="neutral">{preview.lines} dòng hạng mục</Badge>
            <Badge tone={preview.errors.length ? 'bad' : 'neutral'}>{preview.errors.length} dòng lỗi</Badge>
          </div>
          {preview.range && (
            <div className="rounded-lg border border-line-soft bg-canvas px-3 py-2 text-[13.5px] text-ink-2">
              <div>
                <b>App đọc ngày như sau</b> (kiểm tra ngày/tháng không bị đảo): từ {fmtVnLong(preview.range.from, tz)} đến {fmtVnLong(preview.range.to, tz)}
              </div>
              <ul className="mt-1 list-disc pl-5">
                {preview.sample.map((q) => (
                  <li key={q.code}>
                    {q.code}: khách yêu cầu {fmtVnLong(q.requested_at, tz)} · gửi {fmtVnLong(q.sent_at, tz)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.unmatchedItems.length > 0 && (
            <Banner tone="warn" title={`${preview.unmatchedItems.length} hạng mục không khớp tên trong Thư viện giá`}>
              Vẫn nhập được, nhưng các dòng này không dùng để gợi ý báo giá tương tự: {preview.unmatchedItems.slice(0, 8).join(', ')}
              {preview.unmatchedItems.length > 8 ? '…' : ''}
            </Banner>
          )}
          {preview.errors.length > 0 && (
            <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-bad">
              {preview.errors.map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  Dòng {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-ink-3">Sau khi nhập, mở Diagnostics để so kết quả app tính với baseline {fmtNum(8.66, 2)} giờ / 52,6%.</p>
        </div>
      )}
    </Modal>
  );
}

/** Standard quote terms (checklist on every quote). PM, CEO and Admin edit; new quotes start with the ones marked default. */
function TermsCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => loadTerms(true), []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  const terms = data ?? [];
  const add = () =>
    run(async () => {
      check(await supabase.from('quote_terms').insert({ text: draft.trim(), position: Math.max(0, ...terms.map((t) => t.position)) + 1 }));
      setDraft('');
    }, 'Đã thêm điều khoản');
  const patch = (t: QuoteTerm, p: Partial<QuoteTerm>) => run(async () => check(await supabase.from('quote_terms').update(p).eq('id', t.id)));
  const move = (t: QuoteTerm, dir: -1 | 1) => {
    const active = terms.filter((x) => x.active);
    const i = active.findIndex((x) => x.id === t.id);
    const other = active[i + dir];
    if (!other) return;
    run(async () => {
      check(await supabase.from('quote_terms').update({ position: other.position }).eq('id', t.id));
      check(await supabase.from('quote_terms').update({ position: t.position === other.position ? t.position + dir : t.position }).eq('id', other.id));
    });
  };

  return (
    <Card className="mt-4" title="Điều khoản mẫu trên báo giá" subtitle="Account tick chọn trên từng báo giá. Mục “Mặc định” được tick sẵn khi tạo báo giá mới.">
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {terms.map((t) => (
            <li key={t.id} className={`flex flex-wrap items-center gap-2 py-2 ${t.active ? '' : 'opacity-50'}`}>
              {canEdit ? (
                <input
                  aria-label="Nội dung điều khoản"
                  defaultValue={t.text}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.text && patch(t, { text: e.target.value.trim() })}
                  className="min-h-[40px] min-w-[240px] flex-1 rounded-lg border border-transparent px-2 text-[14.5px] hover:border-line focus:border-brand"
                />
              ) : (
                <span className="flex-1 text-[14.5px]">{t.text}</span>
              )}
              <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <input type="checkbox" className="h-4 w-4" checked={t.default_on} disabled={!canEdit || busy || !t.active} onChange={(e) => patch(t, { default_on: e.target.checked })} /> Mặc định
              </label>
              {canEdit && (
                <div className="flex items-center gap-1">
                  {t.active && (
                    <>
                      <IconButton icon="chevronDown" className="rotate-180" label="Đưa lên" onClick={() => move(t, -1)} disabled={busy} />
                      <IconButton icon="chevronDown" label="Đưa xuống" onClick={() => move(t, 1)} disabled={busy} />
                    </>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch(t, { active: !t.active, ...(t.active ? { default_on: false } : {}) })}>
                    {t.active ? 'Ngừng dùng' : 'Dùng lại'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <Input aria-label="Điều khoản mới" value={draft} placeholder="Thêm điều khoản mẫu" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && draft.trim() && add()} />
          <Button icon="plus" disabled={!draft.trim() || busy} onClick={add}>
            Thêm
          </Button>
        </div>
      )}
    </Card>
  );
}
