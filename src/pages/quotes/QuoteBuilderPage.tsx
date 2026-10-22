import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BAND_LABEL,
  copyLinesWithTodayPrices,
  fmtNum,
  isDirectlyEditable,
  linesMissingOverrideReason,
  PublicBand,
  quoteTotals,
  rankSimilar,
  ROLE_LABEL,
  validateQuote,
  workingHoursBetween,
} from '@/domain';
import { Badge, Banner, Button, Card, ErrorBox, Field, Icon, IconButton, Input, Loading, Modal, Select, Textarea, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnd, fmtVnDate, fmtVnDateTime, fmtVnLong, fromLocalInput, toLocalInput } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { ApprovalRow, LibraryItem, LINE_COLS, LineRow, loadLibrary, loadPeople, normLine, normQuote, personName, QUOTE_COLS, QuoteRow } from './data';
import { LibraryPicker } from './LibraryPicker';
import { BandReasons, downloadQuotePdf, PriceTag, QuotePdf, StatusBadge } from './parts';

interface EditLine {
  key: string;
  id?: string;
  library_item_id: string | null;
  item_name: string;
  unit: string;
  qty: number;
  unit_price: number;
  override_reason: string | null;
}

interface Header {
  client: string;
  service_group: string | null;
  requested_at: number;
  discount_pct: number;
  copied_from: string | null;
}

interface ArchiveEntry {
  id: string;
  code: string;
  client: string;
  service_group: string | null;
  sent_at: string;
  total: number;
  quote_lines: { library_item_id: string | null; item_name: string; qty: number }[];
}

const newKey = () => Math.random().toString(36).slice(2);

function snapshot(h: Header, ls: EditLine[]): string {
  return JSON.stringify({ h, ls: ls.map(({ key, ...rest }) => rest) });
}

function parseMoney(v: string): number {
  const digits = v.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function QuoteBuilderPage() {
  const { id = '' } = useParams();
  const me = useProfile();
  const { calendar, tz, settings } = useSettings();
  const toast = useToast();
  const nav = useNavigate();

  const [quote, setQuote] = useState<QuoteRow | null>(null);
  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [people, setPeople] = useState<Map<string, { full_name: string; email: string; role: string }>>(new Map());
  const [archive, setArchive] = useState<ArchiveEntry[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [band, setBand] = useState<PublicBand | null>(null);
  const [bandBusy, setBandBusy] = useState(false);
  const [bandError, setBandError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [decision, setDecision] = useState<{ kind: 'approve' | 'changes'; comment: string } | null>(null);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pdfRef = useRef<HTMLDivElement>(null);

  const state = useRef<{ header: Header | null; lines: EditLine[] }>({ header: null, lines: [] });
  state.current = { header, lines };
  const saved = useRef<{ snap: string; lines: Map<string, EditLine> }>({ snap: '', lines: new Map() });
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [q, ls, ap, lib, ppl, arc] = await Promise.all([
        supabase.from('quotes').select(QUOTE_COLS).eq('id', id).maybeSingle(),
        supabase.from('quote_lines').select(LINE_COLS).eq('quote_id', id).order('position'),
        supabase.from('approvals').select('id, level, approver_id, decision, comment, decided_at').eq('quote_id', id).order('decided_at', { ascending: false }),
        loadLibrary(true),
        loadPeople(),
        supabase.from('quotes').select('id, code, client, service_group, sent_at, total, quote_lines(library_item_id, item_name, qty)').eq('status', 'sent').neq('id', id).order('sent_at', { ascending: false }).limit(400),
      ]);
      const qr = check(q) as QuoteRow | null;
      if (!qr) throw new Error('Không tìm thấy báo giá, hoặc bạn không có quyền xem.');
      const quoteRow = normQuote(qr);
      const lineRows = (check(ls) as LineRow[]).map(normLine);
      const edit = lineRows.map((l) => ({ key: newKey(), id: l.id, library_item_id: l.library_item_id, item_name: l.item_name, unit: l.unit, qty: l.qty, unit_price: l.unit_price, override_reason: l.override_reason }));
      const h: Header = { client: quoteRow.client, service_group: quoteRow.service_group, requested_at: Date.parse(quoteRow.requested_at), discount_pct: quoteRow.discount_pct, copied_from: quoteRow.copied_from };
      setQuote(quoteRow);
      setHeader(h);
      setLines(edit);
      saved.current = { snap: snapshot(h, edit), lines: new Map(edit.filter((l) => l.id).map((l) => [l.id as string, l])) };
      setApprovals(check(ap) as ApprovalRow[]);
      setLibrary(lib);
      setPeople(ppl);
      setArchive((check(arc) as ArchiveEntry[]).map((a) => ({ ...a, total: Number(a.total) })));
      setSaveState('saved');
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const libMap = useMemo(() => new Map(library.map((i) => [i.id, i])), [library]);
  const isOwner = !!quote && quote.created_by === me.id && me.role === 'account';
  const editable = !!quote && isOwner && isDirectlyEditable(quote.status);
  const libPrice = (l: EditLine) => (l.library_item_id ? libMap.get(l.library_item_id)?.unit_price ?? null : null);

  // ---------------------------------------------------------------- saving ----
  const save = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      await inflight.current;
    }
    const { header: h, lines: ls } = state.current;
    if (!h || !quote) return;
    const snap = snapshot(h, ls);
    if (snap === saved.current.snap) {
      setSaveState('saved');
      return;
    }
    const run = (async () => {
      setSaveState('saving');
      try {
        const totals = quoteTotals(ls.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })), h.discount_pct);
        const upd = check(
          await supabase
            .from('quotes')
            .update({ client: h.client, service_group: h.service_group, requested_at: new Date(h.requested_at).toISOString(), discount_pct: h.discount_pct, subtotal: totals.subtotal, total: totals.total, status: 'draft', copied_from: h.copied_from })
            .eq('id', quote.id)
            .select(QUOTE_COLS),
        ) as QuoteRow[];
        if (!upd.length) throw new Error('Không lưu được: báo giá không còn ở trạng thái Nháp. Tải lại trang.');
        const prev = saved.current.lines;
        const keep = new Set(ls.filter((l) => l.id).map((l) => l.id as string));
        const removed = [...prev.keys()].filter((k) => !keep.has(k));
        if (removed.length) check(await supabase.from('quote_lines').delete().in('id', removed));
        const assigned = new Map<string, string>();
        for (const [i, l] of ls.entries()) {
          const row = { position: i + 1, qty: l.qty, unit_price: l.unit_price, library_price: libPrice(l), override_reason: l.override_reason?.trim() || null };
          if (!l.id) {
            const ins = check(await supabase.from('quote_lines').insert({ ...row, quote_id: quote.id, library_item_id: l.library_item_id, item_name: l.item_name, unit: l.unit }).select('id').single()) as { id: string };
            assigned.set(l.key, ins.id);
          } else {
            const p = prev.get(l.id);
            if (!p || p.qty !== l.qty || p.unit_price !== l.unit_price || (p.override_reason ?? '') !== (l.override_reason ?? '') || ls.indexOf(l) !== [...prev.values()].indexOf(p)) {
              check(await supabase.from('quote_lines').update(row).eq('id', l.id));
            }
          }
        }
        const merged = ls.map((l) => (assigned.has(l.key) ? { ...l, id: assigned.get(l.key) } : l));
        if (assigned.size) setLines((cur) => cur.map((l) => (assigned.has(l.key) ? { ...l, id: assigned.get(l.key) } : l)));
        saved.current = { snap: snapshot(h, merged), lines: new Map(merged.filter((l) => l.id).map((l) => [l.id as string, l])) };
        setQuote(normQuote(upd[0]));
        // Compare with what is on screen now (plus the ids just assigned): if the user kept typing, stay dirty.
        const nowLines = state.current.lines.map((l) => (assigned.has(l.key) ? { ...l, id: assigned.get(l.key) } : l));
        setSaveState(snapshot(state.current.header as Header, nowLines) === saved.current.snap ? 'saved' : 'dirty');
      } catch (e) {
        setSaveState('error');
        toast((e as Error).message, 'bad');
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, libMap, toast]);

  useEffect(() => {
    if (!editable || !header) return;
    if (snapshot(header, lines) === saved.current.snap) {
      // e.g. right after a save assigned ids to new lines
      setSaveState((s) => (s === 'dirty' ? 'saved' : s));
      return;
    }
    setSaveState('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(), 700);
    return () => window.clearTimeout(timer.current);
  }, [header, lines, editable, save]);

  async function flush() {
    window.clearTimeout(timer.current);
    await save();
  }

  // ------------------------------------------------------------ band check ----
  const bandInput = JSON.stringify({ l: lines.map((l) => [l.library_item_id, l.qty, l.unit_price]), d: header?.discount_pct });
  useEffect(() => {
    if (!quote || !header || !lines.length || !['draft', 'changes_requested'].includes(quote.status)) {
      setBand(null);
      return;
    }
    if (!(header.discount_pct >= 0 && header.discount_pct <= 100) || lines.some((l) => !(l.qty > 0))) return;
    const t = window.setTimeout(async () => {
      setBandBusy(true);
      try {
        const r = await callApi<{ band: PublicBand }>('quote.band', {
          lines: lines.map((l) => ({ library_item_id: l.library_item_id, item_name: l.item_name, qty: l.qty, unit_price: l.unit_price })),
          discount_pct: header.discount_pct,
        });
        setBand(r.band);
        setBandError(null);
      } catch (e) {
        setBandError((e as Error).message);
      } finally {
        setBandBusy(false);
      }
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandInput, quote?.status]);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!quote || !header) return <Loading />;

  const totals = quoteTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })), header.discount_pct);
  const elapsed = workingHoursBetween(header.requested_at, quote.sent_at ? Date.parse(quote.sent_at) : now, calendar);
  const groups = [...new Set(library.map((i) => i.service_group))].sort();
  const missing = linesMissingOverrideReason(lines.map((l) => ({ unitPrice: l.unit_price, libraryPrice: libPrice(l), overrideReason: l.override_reason })));
  const problems = [
    ...validateQuote({ client: header.client, requestedAt: header.requested_at, now: Date.now(), lines: lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })), discountPct: header.discount_pct }),
    ...(missing.length ? [`Ghi lý do cho đơn giá khác thư viện ở dòng ${missing.map((i) => i + 1).join(', ')}.`] : []),
  ];
  const lastDecision = approvals[0];
  const accountName = personName(people, quote.created_by);
  const canDecide = quote.status === 'pending' && quote.approver === me.role;

  const setH = (patch: Partial<Header>) => setHeader((h) => (h ? { ...h, ...patch } : h));
  const setLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function addItem(item: LibraryItem) {
    // Picking an item that is already on the quote adds 1 to its quantity instead of a duplicate line.
    setLines((ls) => {
      const at = ls.findIndex((l) => l.library_item_id === item.id);
      if (at >= 0) return ls.map((l, i) => (i === at ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: newKey(), library_item_id: item.id, item_name: item.name, unit: item.unit, qty: 1, unit_price: item.unit_price, override_reason: null }];
    });
    if (!header?.service_group) setH({ service_group: item.service_group });
  }

  function copyFrom(src: ArchiveEntry) {
    if (lines.length && !window.confirm(`Thay ${lines.length} dòng hiện tại bằng các hạng mục của ${src.code}?`)) return;
    const res = copyLinesWithTodayPrices(
      src.quote_lines.map((l) => ({ libraryItemId: l.library_item_id, itemName: l.item_name, qty: Number(l.qty) })),
      new Map(library.map((i) => [i.id, { id: i.id, name: i.name, unit: i.unit, unitPrice: i.unit_price, active: i.active }])),
    );
    setLines(res.lines.map((l) => ({ key: newKey(), library_item_id: l.libraryItemId, item_name: l.itemName, unit: l.unit, qty: l.qty, unit_price: l.unitPrice, override_reason: null })));
    setH({ copied_from: src.id, service_group: header?.service_group ?? src.service_group });
    toast(`Đã chép ${res.lines.length} hạng mục từ ${src.code}, giá lấy theo thư viện hôm nay${res.skipped.length ? `. Bỏ qua: ${res.skipped.join(', ')} (không còn trong thư viện)` : ''}`);
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  const sendNow = () =>
    run('send', async () => {
      await flush();
      const r = await callApi<{ quote: QuoteRow }>('quote.send', { quote_id: quote.id });
      setQuote(normQuote(r.quote));
      toast('Đã ghi nhận gửi báo giá và lưu vào Kho tham chiếu. Đang tạo PDF…');
      await new Promise((ok) => setTimeout(ok, 50));
      if (pdfRef.current) await downloadQuotePdf(pdfRef.current, r.quote.code as string);
      await load();
    });

  const submit = () =>
    run('submit', async () => {
      await flush();
      const r = await callApi<{ quote: QuoteRow }>('quote.submit', { quote_id: quote.id });
      setQuote(normQuote(r.quote));
      toast(`Đã gửi ${ROLE_LABEL[(r.quote.approver as 'pm' | 'ceo') ?? 'pm']} duyệt`);
      await load();
    });

  const reopen = () =>
    run('reopen', async () => {
      await callApi('quote.reopen', { quote_id: quote.id });
      setConfirmReopen(false);
      toast('Báo giá đã về Nháp. Sửa xong thì gửi duyệt lại.', 'info');
      await load();
    });

  const decide = () =>
    run('decide', async () => {
      if (!decision) return;
      await callApi('quote.decide', { quote_id: quote.id, decision: decision.kind, comment: decision.comment });
      setDecision(null);
      toast(decision.kind === 'approve' ? 'Đã duyệt báo giá' : 'Đã gửi yêu cầu sửa cho Account');
      await load();
    });

  const removeDraft = () =>
    run('delete', async () => {
      if (!window.confirm(`Xoá báo giá nháp ${quote.code}?`)) return;
      check(await supabase.from('quotes').delete().eq('id', quote.id));
      toast('Đã xoá báo giá nháp');
      nav('/quotes');
    });

  const duplicate = () =>
    run('dup', async () => {
      const q = check(await supabase.from('quotes').insert({ client: quote.client, service_group: quote.service_group, requested_at: new Date().toISOString(), copied_from: quote.id }).select('id').single()) as { id: string };
      const res = copyLinesWithTodayPrices(
        lines.map((l) => ({ libraryItemId: l.library_item_id, itemName: l.item_name, qty: l.qty })),
        new Map(library.map((i) => [i.id, { id: i.id, name: i.name, unit: i.unit, unitPrice: i.unit_price, active: i.active }])),
      );
      if (res.lines.length) {
        check(
          await supabase.from('quote_lines').insert(
            res.lines.map((l, i) => ({ quote_id: q.id, position: i + 1, library_item_id: l.libraryItemId, item_name: l.itemName, unit: l.unit, qty: l.qty, unit_price: l.unitPrice, library_price: l.libraryPrice })),
          ),
        );
      }
      toast('Đã tạo báo giá mới với giá thư viện hôm nay');
      nav(`/quotes/${q.id}`);
    });

  const usage = new Map<string, number>();
  for (const a of archive) for (const id of new Set(a.quote_lines.map((l) => l.library_item_id))) if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
  const similar = rankSimilar(
    { serviceGroup: header.service_group, itemIds: lines.map((l) => l.library_item_id).filter((x): x is string => !!x), excludeId: quote.id },
    archive.map((a) => ({ id: a.id, serviceGroup: a.service_group, itemIds: a.quote_lines.map((l) => l.library_item_id).filter((x): x is string => !!x), sentAt: Date.parse(a.sent_at) })),
  ).map((r) => ({ ...r, q: archive.find((a) => a.id === r.id)! }));

  const pdfLines: LineRow[] = lines.map((l, i) => ({ id: l.id ?? l.key, quote_id: quote.id, position: i + 1, library_item_id: l.library_item_id, item_name: l.item_name, unit: l.unit, qty: l.qty, unit_price: l.unit_price, library_price: libPrice(l), override_reason: l.override_reason }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/quotes" className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 hover:bg-white" aria-label="Về danh sách báo giá">
            <Icon name="chevronRight" className="rotate-180" />
          </Link>
          <div className="min-w-0">
            <div className="text-[13px] font-bold uppercase tracking-wide text-accent">Báo giá · S2 Quotation Builder</div>
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold text-ink">
              {quote.code} <StatusBadge status={quote.status} />
              {quote.source === 'import' && <Badge tone="neutral">Lịch sử (import)</Badge>}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-[10px] border border-line bg-white px-3 py-1.5 text-[13px] leading-tight">
            <span className="text-ink-3">Thời gian xử lý (giờ làm việc)</span>
            <br />
            <b className={elapsed > (settings?.quote_late_hours ?? 8) ? 'text-bad' : 'text-ink'}>{fmtNum(elapsed, 2)} giờ</b>
            <span className="text-ink-3"> · mục tiêu ≤ {settings?.quote_late_hours ?? 8} giờ</span>
          </div>
          {editable && (
            <span className="text-[13px] text-ink-3" aria-live="polite">
              {saveState === 'saving' ? 'Đang lưu…' : saveState === 'dirty' ? 'Chưa lưu' : saveState === 'error' ? 'Lỗi lưu' : 'Đã lưu'}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Báo giá" className="flex min-w-0 flex-[999_1_640px] flex-col gap-4 rounded-2xl border border-line bg-white p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Khách hàng">{(fid) => <Input id={fid} value={header.client} disabled={!editable} onChange={(e) => setH({ client: e.target.value })} placeholder="Tên khách / thương hiệu" />}</Field>
            <Field label="Khách gửi yêu cầu lúc" hint={`Mốc bắt đầu tính thời gian báo giá · đang chọn ${fmtVnLong(header.requested_at, tz)}`}>
              {(fid) => (
                <Input
                  id={fid}
                  type="datetime-local"
                  value={toLocalInput(header.requested_at, tz)}
                  disabled={!editable}
                  onChange={(e) => {
                    const v = fromLocalInput(e.target.value, tz);
                    if (v !== null) setH({ requested_at: v });
                  }}
                />
              )}
            </Field>
            <Field label="Nhóm dịch vụ" hint="Dùng để tìm báo giá tương tự">
              {(fid) => (
                <Select id={fid} value={header.service_group ?? ''} disabled={!editable} onChange={(e) => setH({ service_group: e.target.value || null })}>
                  <option value="">— Chọn —</option>
                  {[...new Set([...groups, ...(header.service_group ? [header.service_group] : [])])].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[15px]">
              <thead>
                <tr className="whitespace-nowrap bg-ink text-left text-sm font-semibold text-white">
                  <th className="rounded-tl-[10px] px-3 py-3">Hạng mục</th>
                  <th className="px-3 py-3">Đơn vị</th>
                  <th className="w-24 px-3 py-3 text-center">SL</th>
                  <th className="px-3 py-3 text-right">Đơn giá (đ)</th>
                  <th className="px-3 py-3 text-right">Thành tiền (đ)</th>
                  <th className="w-12 rounded-tr-[10px] px-1 py-3">
                    <span className="sr-only">Xoá</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!lines.length && (
                  <tr>
                    <td colSpan={6} className="border-b border-line-soft px-3 py-6 text-ink-3">
                      Chưa có hạng mục. Thêm từ Thư viện giá, hoặc chép từ một báo giá tương tự bên phải.
                    </td>
                  </tr>
                )}
                {lines.map((l) => {
                  const lp = libPrice(l);
                  const custom = lp !== null && l.unit_price !== lp;
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="border-b border-line-soft px-3 py-2.5">
                        <div className="font-semibold">{l.item_name}</div>
                        <div className="text-[12.5px] text-ink-3">
                          {l.library_item_id ? libMap.get(l.library_item_id)?.service_group : 'Không thuộc thư viện'}
                          {lp !== null && custom && ` · giá thư viện ${fmtVnd(lp)}`}
                        </div>
                        {(custom || l.override_reason) && (
                          <Input
                            aria-label={`Lý do giá khác thư viện: ${l.item_name}`}
                            className="mt-2 min-h-[40px] text-sm"
                            value={l.override_reason ?? ''}
                            disabled={!editable}
                            placeholder="Lý do giá khác thư viện (bắt buộc)"
                            onChange={(e) => setLine(l.key, { override_reason: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="whitespace-nowrap border-b border-line-soft px-3 py-2.5 text-ink-2">{l.unit}</td>
                      <td className="border-b border-line-soft px-3 py-2.5">
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          aria-label={`Số lượng: ${l.item_name}`}
                          value={l.qty}
                          disabled={!editable}
                          onChange={(e) => setLine(l.key, { qty: Math.max(0, Number(e.target.value) || 0) })}
                          className="h-10 w-full rounded-lg border-[1.5px] border-[#F5C99A] bg-[#FFF8EC] text-center font-bold disabled:border-line disabled:bg-canvas"
                        />
                      </td>
                      <td className="border-b border-line-soft px-3 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <PriceTag unitPrice={l.unit_price} libraryPrice={lp} />
                          <input
                            inputMode="numeric"
                            aria-label={`Đơn giá: ${l.item_name}`}
                            value={fmtVnd(l.unit_price, false)}
                            disabled={!editable}
                            onChange={(e) => setLine(l.key, { unit_price: parseMoney(e.target.value) })}
                            className="h-10 w-32 rounded-lg border-[1.5px] border-line px-2 text-right tabular-nums disabled:bg-canvas"
                          />
                        </div>
                      </td>
                      <td className="whitespace-nowrap border-b border-line-soft px-3 py-2.5 text-right font-semibold tabular-nums">{fmtVnd(Math.round(l.qty * l.unit_price), false)}</td>
                      <td className="border-b border-line-soft px-1 py-1.5">
                        {editable && <IconButton icon="x" label={`Xoá dòng ${l.item_name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {editable && (
            <div>
              <Button variant="accent" icon="plus" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
                Thêm hạng mục từ Thư viện giá
              </Button>
              {pickerOpen && (
                <LibraryPicker library={library} lines={lines} usage={usage} preferredGroup={header.service_group} onAdd={addItem} onClose={() => setPickerOpen(false)} />
              )}
            </div>
          )}

          <div className="flex justify-end">
            <div className="flex w-full max-w-[420px] flex-col gap-2 text-[15px]">
              <div className="flex justify-between">
                <span className="text-ink-2">Cộng</span>
                <b className="tabular-nums">{fmtVnd(totals.subtotal)}</b>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="discount" className="text-ink-2">
                  Chiết khấu (%)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="discount"
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={header.discount_pct}
                    disabled={!editable}
                    onChange={(e) => setH({ discount_pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                    className="h-10 w-20 rounded-lg border-[1.5px] border-[#F5C99A] bg-[#FFF8EC] text-center font-bold disabled:border-line disabled:bg-canvas"
                  />
                  <span className="min-w-[110px] text-right tabular-nums">− {fmtVnd(totals.discountAmount)}</span>
                </div>
              </div>
              <div className="flex justify-between border-t-2 border-ink pt-2 text-xl">
                <b>Tổng</b>
                <b className="tabular-nums">{fmtVnd(totals.total)}</b>
              </div>
            </div>
          </div>

          {/* ---------------- status panels ---------------- */}
          {quote.status === 'changes_requested' && lastDecision?.decision === 'changes' && (
            <Banner tone="bad" title={`${ROLE_LABEL[lastDecision.level]} yêu cầu sửa`}>
              “{lastDecision.comment}” — {personName(people, lastDecision.approver_id)}, {fmtVnDateTime(lastDecision.decided_at, tz)}. Sửa báo giá rồi gửi lại.
            </Banner>
          )}
          {editable && lines.length > 0 && (
            <>
              {bandError && <Banner tone="bad">{bandError}</Banner>}
              {!band || bandBusy ? (
                <Banner tone="info" title="Đang kiểm tra khung giá…" />
              ) : band.level === 'send_now' ? (
                <Banner
                  tone="ok"
                  title="Trong khung giá · Account gửi được ngay"
                  actions={
                    <Button variant="success" icon="send" busy={busy === 'send'} disabled={!!problems.length || saveState === 'saving'} onClick={sendNow}>
                      Xuất PDF & gửi
                    </Button>
                  }
                >
                  Chiết khấu {fmtNum(band.discountPct, 1)}% · đơn giá lệch thư viện nhiều nhất {fmtNum(band.maxDeviationPct, 1)}%
                </Banner>
              ) : (
                <Banner
                  tone="warn"
                  title={`Ngoài khung giá · ${BAND_LABEL[band.level]}`}
                  actions={
                    <Button icon="send" busy={busy === 'submit'} disabled={!!problems.length || saveState === 'saving'} onClick={submit}>
                      Gửi {band.level === 'pm' ? 'PM' : 'CEO'} duyệt
                    </Button>
                  }
                >
                  <BandReasons band={band} />
                </Banner>
              )}
              {problems.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-bad">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {quote.status === 'pending' && (
            <Banner
              tone="info"
              title={`Đang chờ ${quote.approver === 'ceo' ? 'CEO' : 'PM'} duyệt`}
              actions={isOwner && <Button variant="secondary" icon="edit" onClick={() => setConfirmReopen(true)}>Sửa báo giá</Button>}
            >
              Gửi duyệt lúc {quote.approval_requested_at ? fmtVnDateTime(quote.approval_requested_at, tz) : '–'}. Chỉ báo giá ngoài khung mới đến bước này.
              <BandReasons band={quote.band_detail} />
            </Banner>
          )}
          {canDecide && (
            <Card title="Quyết định của bạn" subtitle="Báo giá này đang chờ đúng cấp của bạn duyệt">
              <div className="flex flex-wrap gap-2">
                <Button icon="check" onClick={() => setDecision({ kind: 'approve', comment: '' })}>
                  Duyệt
                </Button>
                <Button variant="secondary" icon="edit" onClick={() => setDecision({ kind: 'changes', comment: '' })}>
                  Yêu cầu sửa
                </Button>
              </div>
            </Card>
          )}
          {quote.status === 'approved' && (
            <Banner
              tone="ok"
              title={`Đã được ${lastDecision ? ROLE_LABEL[lastDecision.level] : ''} duyệt · sẵn sàng gửi`}
              actions={
                isOwner && (
                  <>
                    <Button variant="secondary" icon="edit" onClick={() => setConfirmReopen(true)}>
                      Sửa (phải duyệt lại)
                    </Button>
                    <Button variant="success" icon="send" busy={busy === 'send'} onClick={sendNow}>
                      Xuất PDF & gửi
                    </Button>
                  </>
                )
              }
            >
              {lastDecision?.comment && `“${lastDecision.comment}” — `}
              {lastDecision && `${personName(people, lastDecision.approver_id)}, ${fmtVnDateTime(lastDecision.decided_at, tz)}`}
            </Banner>
          )}
          {quote.status === 'sent' && (
            <div className="overflow-hidden rounded-[14px] border-[1.5px] border-ink">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-ink px-4 py-3 font-bold text-white">
                <span>Đã gửi {quote.client} · {quote.sent_at && fmtVnDateTime(quote.sent_at, tz)}</span>
                <span>Xử lý trong {fmtNum(elapsed, 2)} giờ làm việc</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="font-semibold text-ok-ink">Đã lưu vào Kho tham chiếu để báo giá tương tự sau này dùng lại.</span>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" icon="download" busy={busy === 'pdf'} onClick={() => run('pdf', async () => { if (pdfRef.current) await downloadQuotePdf(pdfRef.current, quote.code); })}>
                    Tải PDF
                  </Button>
                  {me.role === 'account' && (
                    <Button variant="secondary" icon="copy" busy={busy === 'dup'} onClick={duplicate}>
                      Tạo báo giá mới từ báo giá này
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          {editable && quote.status === 'draft' && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" icon="trash" busy={busy === 'delete'} onClick={removeDraft}>
                Xoá nháp
              </Button>
            </div>
          )}
          <p className="text-[13px] text-ink-3">
            Người lập: {accountName} · tạo lúc {fmtVnDateTime(quote.created_at, tz)}
          </p>
        </section>

        <aside aria-label="Báo giá tương tự" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-2xl border border-line bg-white p-5">
          <div>
            <h2 className="text-lg font-extrabold text-ink">Báo giá tương tự đã gửi</h2>
            <p className="mt-1 text-sm text-ink-3">Từ Kho tham chiếu · cùng nhóm dịch vụ trước, rồi theo số hạng mục trùng</p>
          </div>
          {!similar.length && <p className="text-sm text-ink-3">Chưa có báo giá tương tự. Chọn nhóm dịch vụ hoặc thêm hạng mục để gợi ý.</p>}
          {similar.map(({ q, sharedItems, sameGroup }) => (
            <div key={q.id} className="flex flex-col gap-1.5 rounded-xl border border-line p-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <Link to={`/quotes/${q.id}`} className="whitespace-nowrap font-bold text-ink hover:text-brand">
                  {q.code}
                </Link>
                <span className="whitespace-nowrap text-[12px] text-ink-3">
                  {sameGroup ? 'Cùng nhóm' : 'Khác nhóm'} · {sharedItems} hạng mục trùng
                </span>
              </div>
              <div className="text-[14.5px] leading-snug">
                {q.client} · {q.quote_lines.slice(0, 3).map((l) => `${Number(l.qty)} × ${l.item_name}`).join(', ')}
                {q.quote_lines.length > 3 ? '…' : ''}
              </div>
              <div className="flex items-center justify-between gap-2 text-[13.5px] text-ink-3">
                <span className="leading-snug">
                  <span className="whitespace-nowrap">{fmtVnDate(q.sent_at, tz)}</span> · <span className="whitespace-nowrap font-semibold text-ink-2">{fmtVnd(q.total)}</span>
                </span>
                {editable && (
                  <button type="button" onClick={() => copyFrom(q)} className="min-h-[40px] shrink-0 whitespace-nowrap rounded-lg bg-accent-soft px-3 font-bold text-accent">
                    Chép hạng mục →
                  </button>
                )}
              </div>
            </div>
          ))}
        </aside>
      </div>

      <div aria-hidden="true" style={{ position: 'fixed', left: '-10000px', top: 0 }}>
        <QuotePdf ref={pdfRef} quote={{ ...quote, discount_pct: header.discount_pct, client: header.client }} lines={pdfLines} company={settings?.company_name ?? 'Go Media'} preparedBy={accountName} tz={tz} />
      </div>

      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision?.kind === 'approve' ? `Duyệt ${quote.code}` : `Yêu cầu sửa ${quote.code}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>
              Huỷ
            </Button>
            <Button busy={busy === 'decide'} disabled={decision?.kind === 'changes' && !decision.comment.trim()} onClick={decide}>
              {decision?.kind === 'approve' ? 'Duyệt báo giá' : 'Gửi yêu cầu sửa'}
            </Button>
          </>
        }
      >
        <Field label={decision?.kind === 'approve' ? 'Nhận xét (không bắt buộc)' : 'Cần sửa gì? (bắt buộc)'}>
          {(fid) => <Textarea id={fid} value={decision?.comment ?? ''} onChange={(e) => setDecision((d) => (d ? { ...d, comment: e.target.value } : d))} />}
        </Field>
      </Modal>
      <Modal
        open={confirmReopen}
        onClose={() => setConfirmReopen(false)}
        title="Sửa báo giá?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReopen(false)}>
              Huỷ
            </Button>
            <Button busy={busy === 'reopen'} onClick={reopen}>
              Đưa về Nháp để sửa
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-ink-2">Mọi chỉnh sửa sau khi gửi duyệt hoặc đã duyệt đều đưa báo giá về Nháp. Sửa xong phải gửi duyệt lại (nếu vẫn ngoài khung giá).</p>
      </Modal>
    </div>
  );
}
