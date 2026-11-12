import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ANCHOR_LABEL,
  approveGate,
  BAND_LABEL,
  canComment,
  copyLinesWithTodayPrices,
  DEFAULT_SECTION_TITLE,
  fmtNum,
  groupBySection,
  isDirectlyEditable,
  LineKind,
  linesMissingOverrideReason,
  PublicBand,
  quoteTotals,
  appendScope,
  rankSimilar,
  requestChangesGate,
  ROLE_LABEL,
  sendGate,
  toRoman,
  validateQuote,
  workingHoursBetween,
} from '@/domain';
import { Badge, Banner, Button, Card, cx, ErrorBox, Field, Icon, IconButton, Input, Loading, Modal, Select, Textarea, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnd, fmtVnDate, fmtVnDateTime, fmtVnLong, fromLocalInput, toLocalInput } from '@/lib/format';
import { useProfile } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { check, supabase } from '@/lib/supabase';
import { ApprovalRow, LibraryItem, LINE_COLS, LineRow, loadLibrary, loadPeople, loadTerms, normLine, normQuote, personName, QUOTE_COLS, QuoteRow, QuoteTerm } from './data';
import { LibraryPicker } from './LibraryPicker';
import { BandReasons, BandRuler, companyFromSettings, downloadQuotePdf, QuotePdf, StatusBadge } from './parts';
import { AnchorThreads, CommentTableRow, CommentToggle, copyText, quoteLink, ReviewCard, ReviewProvider } from './review';

interface EditLine {
  key: string;
  id?: string;
  library_item_id: string | null;
  item_name: string;
  unit: string;
  qty: number;
  unit_price: number;
  override_reason: string | null;
  section: string;
  description: string | null;
  kind: LineKind;
}

interface Header {
  client: string;
  contact: string;
  project: string;
  venue: string;
  service_group: string | null;
  requested_at: number;
  discount_pct: number;
  vat_pct: number;
  terms: string[];
  copied_from: string | null;
}

/** Picker target meaning "put the item in a section named after its service group". */
const AUTO_SECTION = '__auto__';
const sectionOf = (l: { section?: string | null }) => (l.section ?? '').trim() || DEFAULT_SECTION_TITLE;

interface ArchiveEntry {
  id: string;
  code: string;
  client: string;
  service_group: string | null;
  sent_at: string;
  total: number;
  quote_lines: { library_item_id: string | null; item_name: string; unit: string; qty: number; unit_price: number; position: number; section: string | null; description: string | null }[];
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
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [extraSections, setExtraSections] = useState<string[]>([]);
  const [newSection, setNewSection] = useState<string | null>(null);
  const [customTerm, setCustomTerm] = useState('');
  const [termLib, setTermLib] = useState<QuoteTerm[]>([]);
  const [preview, setPreview] = useState(false);
  const [decision, setDecision] = useState<{ kind: 'approve' | 'changes'; comment: string } | null>(null);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [openComments, setOpenComments] = useState(0);
  const pdfRef = useRef<HTMLDivElement>(null);

  const state = useRef<{ header: Header | null; lines: EditLine[] }>({ header: null, lines: [] });
  state.current = { header, lines };
  const saved = useRef<{ snap: string; lines: Map<string, EditLine> }>({ snap: '', lines: new Map() });
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [q, ls, ap, lib, ppl, arc, terms] = await Promise.all([
        supabase.from('quotes').select(QUOTE_COLS).eq('id', id).maybeSingle(),
        supabase.from('quote_lines').select(LINE_COLS).eq('quote_id', id).order('position'),
        supabase.from('approvals').select('id, level, approver_id, decision, comment, decided_at').eq('quote_id', id).order('decided_at', { ascending: false }),
        loadLibrary(true),
        loadPeople(),
        supabase.from('quotes').select('id, code, client, service_group, sent_at, total, quote_lines(library_item_id, item_name, unit, qty, unit_price, position, section, description)').eq('status', 'sent').neq('id', id).order('sent_at', { ascending: false }).limit(400),
        loadTerms(true),
      ]);
      const qr = check(q) as QuoteRow | null;
      if (!qr) throw new Error('Không tìm thấy báo giá, hoặc bạn không có quyền xem.');
      const quoteRow = normQuote(qr);
      const lineRows = (check(ls) as LineRow[]).map(normLine);
      const edit: EditLine[] = lineRows.map((l) => ({
        // Saved lines keep their id as key, so a refresh does not close an open comment box.
        key: l.id,
        id: l.id,
        library_item_id: l.library_item_id,
        item_name: l.item_name,
        unit: l.unit,
        qty: l.qty,
        unit_price: l.unit_price,
        override_reason: l.override_reason,
        section: l.section,
        description: l.description,
        kind: l.kind,
      }));
      const h: Header = {
        client: quoteRow.client,
        contact: quoteRow.contact,
        project: quoteRow.project,
        venue: quoteRow.venue,
        service_group: quoteRow.service_group,
        requested_at: Date.parse(quoteRow.requested_at),
        discount_pct: quoteRow.discount_pct,
        vat_pct: quoteRow.vat_pct,
        terms: quoteRow.terms,
        copied_from: quoteRow.copied_from,
      };
      setTermLib(terms);
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
  const libForCopy = useMemo(
    () => new Map(library.map((i) => [i.id, { id: i.id, name: i.name, unit: i.unit, unitPrice: i.unit_price, active: i.active, kind: i.kind, description: i.description }])),
    [library],
  );
  const isOwner = !!quote && quote.created_by === me.id && me.role === 'account';
  const editable = !!quote && isOwner && isDirectlyEditable(quote.status);
  const libPrice = (l: EditLine) => (l.library_item_id ? libMap.get(l.library_item_id)?.unit_price ?? null : null);

  // Someone reading a quote they cannot edit (the PM reviewing, or the Account while it waits for
  // approval) gets the other side's changes without reloading: status, lines and totals.
  const seenUpdate = quote?.updated_at;
  useEffect(() => {
    if (!quote || editable || quote.status === 'sent') return;
    const t = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase.from('quotes').select('updated_at, status').eq('id', quote.id).maybeSingle();
      if (data && (data.updated_at !== seenUpdate || data.status !== quote.status)) load();
    }, 20_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id, quote?.status, seenUpdate, editable, load]);

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
        const totals = quoteTotals(
          ls.map((l) => ({ qty: l.qty, unitPrice: l.unit_price, kind: l.kind })),
          h.discount_pct,
          { pct: h.vat_pct, onPassThrough: !!settings?.vat_on_pass_through },
        );
        const upd = check(
          await supabase
            .from('quotes')
            .update({
              client: h.client,
              contact: h.contact,
              project: h.project,
              venue: h.venue,
              service_group: h.service_group,
              requested_at: new Date(h.requested_at).toISOString(),
              discount_pct: h.discount_pct,
              vat_pct: h.vat_pct,
              terms: h.terms,
              subtotal: totals.subtotal,
              total: totals.total,
              vat_amount: totals.vatAmount,
              grand_total: totals.grandTotal,
              status: 'draft',
              copied_from: h.copied_from,
            })
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
          const row = {
            position: i + 1,
            qty: l.qty,
            unit_price: l.unit_price,
            library_price: libPrice(l),
            override_reason: l.override_reason?.trim() || null,
            section: sectionOf(l),
            description: l.description?.trim() || null,
          };
          if (!l.id) {
            const ins = check(
              await supabase.from('quote_lines').insert({ ...row, quote_id: quote.id, library_item_id: l.library_item_id, item_name: l.item_name, unit: l.unit, kind: l.kind }).select('id').single(),
            ) as { id: string };
            assigned.set(l.key, ins.id);
          } else {
            const p = prev.get(l.id);
            if (
              !p ||
              p.qty !== l.qty ||
              p.unit_price !== l.unit_price ||
              (p.override_reason ?? '') !== (l.override_reason ?? '') ||
              sectionOf(p) !== sectionOf(l) ||
              (p.description ?? '') !== (l.description ?? '') ||
              ls.indexOf(l) !== [...prev.values()].indexOf(p)
            ) {
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
  }, [quote, libMap, toast, settings?.vat_on_pass_through]);

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
  const bandInput = JSON.stringify({ l: lines.map((l) => [l.library_item_id, l.qty, l.unit_price, l.kind]), d: header?.discount_pct });
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
          lines: lines.map((l) => ({ library_item_id: l.library_item_id, item_name: l.item_name, qty: l.qty, unit_price: l.unit_price, kind: l.kind })),
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

  const vatOnPassThrough = !!settings?.vat_on_pass_through;
  const totals = quoteTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price, kind: l.kind })), header.discount_pct, { pct: header.vat_pct, onPassThrough: vatOnPassThrough });
  const elapsed = workingHoursBetween(header.requested_at, quote.sent_at ? Date.parse(quote.sent_at) : now, calendar);
  const groups = [...new Set(library.map((i) => i.service_group))].sort();
  const missing = linesMissingOverrideReason(lines.map((l) => ({ unitPrice: l.unit_price, libraryPrice: libPrice(l), overrideReason: l.override_reason, kind: l.kind })));
  const problems = [
    ...validateQuote({ client: header.client, requestedAt: header.requested_at, now: Date.now(), lines: lines.map((l) => ({ qty: l.qty, unitPrice: l.unit_price })), discountPct: header.discount_pct, vatPct: header.vat_pct }),
    ...(missing.length ? [`Ghi lý do cho đơn giá khác thư viện ở dòng ${missing.map((i) => i + 1).join(', ')}.`] : []),
  ];
  const lastDecision = approvals[0];
  const accountName = personName(people, quote.created_by);
  const canDecide = quote.status === 'pending' && quote.approver === me.role;
  const canReview = canComment(me.role, quote.created_by === me.id, quote.status);
  const sendBlock = sendGate(openComments);
  const copyLink = async () => toast((await copyText(quoteLink(quote.id))) ? `Đã sao chép link ${quote.code}. Dán vào Lark để gửi người duyệt.` : 'Không sao chép được. Hãy chép địa chỉ trên thanh trình duyệt.', 'info');

  const setH = (patch: Partial<Header>) => setHeader((h) => (h ? { ...h, ...patch } : h));
  const setLine = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // ------------------------------------------------------------ sections ----
  const grouped = groupBySection(lines.map((l) => ({ ...l, unitPrice: l.unit_price })));
  const sectionTitles = [...grouped.map((g) => g.title), ...extraSections.filter((t) => !grouped.some((g) => g.title === t))];

  function addItem(item: LibraryItem, target: string) {
    const section = target === AUTO_SECTION ? item.service_group : target;
    // Picking an item already in this section adds 1 to its quantity instead of a duplicate line.
    setLines((ls) => {
      const at = ls.findIndex((l) => l.library_item_id === item.id && sectionOf(l) === section);
      if (at >= 0) return ls.map((l, i) => (i === at ? { ...l, qty: l.qty + 1 } : l));
      const line: EditLine = {
        key: newKey(),
        library_item_id: item.id,
        item_name: item.name,
        unit: item.unit,
        qty: 1,
        unit_price: item.unit_price,
        override_reason: null,
        section,
        description: item.description,
        kind: item.kind,
      };
      const last = ls.map((l) => sectionOf(l)).lastIndexOf(section);
      return last < 0 ? [...ls, line] : [...ls.slice(0, last + 1), line, ...ls.slice(last + 1)];
    });
    if (target === AUTO_SECTION) setPickerFor(section);
    if (!header?.service_group) setH({ service_group: item.service_group });
  }

  function moveLine(key: string, to: string) {
    setLines((ls) => {
      const line = ls.find((l) => l.key === key);
      if (!line) return ls;
      const rest = ls.filter((l) => l.key !== key);
      const moved = { ...line, section: to };
      const last = rest.map((l) => sectionOf(l)).lastIndexOf(to);
      return last < 0 ? [...rest, moved] : [...rest.slice(0, last + 1), moved, ...rest.slice(last + 1)];
    });
  }

  function renameSection(from: string, to: string) {
    const name = to.trim();
    if (!name || name === from) return;
    if (sectionTitles.includes(name)) {
      toast(`Đã có phần "${name}".`, 'bad');
      return;
    }
    setLines((ls) => ls.map((l) => (sectionOf(l) === from ? { ...l, section: name } : l)));
    setExtraSections((xs) => xs.map((x) => (x === from ? name : x)));
    if (pickerFor === from) setPickerFor(name);
  }

  function removeSection(title: string) {
    const n = lines.filter((l) => sectionOf(l) === title).length;
    if (n && !window.confirm(`Xoá phần "${title}" cùng ${n} hạng mục trong đó?`)) return;
    setLines((ls) => ls.filter((l) => sectionOf(l) !== title));
    setExtraSections((xs) => xs.filter((x) => x !== title));
    if (pickerFor === title) setPickerFor(null);
  }

  function addSection() {
    const name = (newSection ?? '').trim();
    if (!name) return;
    if (sectionTitles.includes(name)) {
      toast(`Đã có phần "${name}".`, 'bad');
      return;
    }
    setExtraSections((xs) => [...xs, name]);
    setNewSection(null);
    setPickerFor(name);
  }

  // --------------------------------------------------------------- terms ----
  function toggleTerm(text: string, on: boolean) {
    if (!header) return;
    const chosen = new Set(header.terms);
    if (on) chosen.add(text);
    else chosen.delete(text);
    // Library terms keep the PM's order; custom terms follow in the order they were added.
    const lib = termLib.filter((t) => chosen.has(t.text)).map((t) => t.text);
    const custom = header.terms.filter((t) => chosen.has(t) && !lib.includes(t));
    if (on && !lib.includes(text) && !custom.includes(text)) custom.push(text);
    setH({ terms: [...lib, ...custom] });
  }

  /** Brings a past quote's items into this one, at today's library prices: appended, or replacing the current lines. */
  function addFrom(src: ArchiveEntry, mode: 'append' | 'replace') {
    if (mode === 'replace' && lines.length && !window.confirm(`Thay ${lines.length} dòng hiện tại bằng các hạng mục của ${src.code}?`)) return;
    const res = copyLinesWithTodayPrices(
      [...src.quote_lines].sort((a, b) => a.position - b.position).map((l) => ({ libraryItemId: l.library_item_id, itemName: l.item_name, qty: Number(l.qty), section: l.section, description: l.description })),
      libForCopy,
    );
    const copied: EditLine[] = res.lines.map((l) => ({
      key: newKey(),
      library_item_id: l.libraryItemId,
      item_name: l.itemName,
      unit: l.unit,
      qty: l.qty,
      unit_price: l.unitPrice,
      override_reason: null,
      section: l.section || libMap.get(l.libraryItemId)?.service_group || DEFAULT_SECTION_TITLE,
      description: l.description,
      kind: l.kind,
    }));
    const skippedNote = res.skipped.length ? `. Bỏ qua ${res.skipped.join(', ')} (không còn trong thư viện)` : '';
    if (mode === 'replace' || !lines.length) {
      setLines(copied);
      setExtraSections([]);
      setH({ copied_from: src.id, service_group: header?.service_group ?? src.service_group });
      toast(`Đã thêm ${copied.length} hạng mục từ ${src.code}, giá theo thư viện hôm nay${skippedNote}`);
      return;
    }
    const { added, already } = appendScope(
      lines.map((l) => ({ libraryItemId: l.library_item_id, section: sectionOf(l) })),
      copied.map((l) => ({ ...l, libraryItemId: l.library_item_id, section: sectionOf(l) })),
    );
    // Each added line goes right after the last line of its section, or into a new section at the end.
    setLines((ls) => {
      let out = [...ls];
      for (const { libraryItemId: _id, ...line } of added) {
        const last = out.map((l) => sectionOf(l)).lastIndexOf(sectionOf(line));
        out = last < 0 ? [...out, line] : [...out.slice(0, last + 1), line, ...out.slice(last + 1)];
      }
      return out;
    });
    if (!header?.copied_from) setH({ copied_from: src.id });
    if (!header?.service_group && src.service_group) setH({ service_group: src.service_group });
    toast(
      `Đã thêm ${added.length} hạng mục từ ${src.code}, giá theo thư viện hôm nay` +
        (already.length ? `. Giữ nguyên ${already.length} hạng mục đã có: ${already.map((l) => l.item_name).join(', ')}` : '') +
        skippedNote,
    );
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
      toast(`Đã gửi ${ROLE_LABEL[(r.quote.approver as 'pm' | 'ceo') ?? 'pm']} duyệt. Bấm "Sao chép link báo giá" để gửi link cho người duyệt.`);
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
      // VAT comes from today's setting (database default); client block and terms are copied.
      const q = check(
        await supabase
          .from('quotes')
          .insert({ client: quote.client, contact: quote.contact, project: quote.project, venue: quote.venue, terms: quote.terms, service_group: quote.service_group, requested_at: new Date().toISOString(), copied_from: quote.id })
          .select('id')
          .single(),
      ) as { id: string };
      const res = copyLinesWithTodayPrices(
        lines.map((l) => ({ libraryItemId: l.library_item_id, itemName: l.item_name, qty: l.qty, section: sectionOf(l), description: l.description })),
        libForCopy,
      );
      if (res.lines.length) {
        check(
          await supabase.from('quote_lines').insert(
            res.lines.map((l, i) => ({
              quote_id: q.id,
              position: i + 1,
              library_item_id: l.libraryItemId,
              item_name: l.itemName,
              unit: l.unit,
              qty: l.qty,
              unit_price: l.unitPrice,
              library_price: l.libraryPrice,
              section: l.section ?? '',
              description: l.description,
              kind: l.kind,
            })),
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

  const pdfLines: LineRow[] = lines.map((l, i) => ({
    id: l.id ?? l.key,
    quote_id: quote.id,
    position: i + 1,
    library_item_id: l.library_item_id,
    item_name: l.item_name,
    unit: l.unit,
    qty: l.qty,
    unit_price: l.unit_price,
    library_price: libPrice(l),
    override_reason: l.override_reason,
    section: sectionOf(l),
    description: l.description,
    kind: l.kind,
  }));
  const pdfQuote: QuoteRow = { ...quote, ...header, requested_at: quote.requested_at };
  const company = companyFromSettings(settings);
  const libraryTerms = termLib.filter((t) => t.active || header.terms.includes(t.text));
  const customTerms = header.terms.filter((t) => !termLib.some((x) => x.text === t));

  return (
    <ReviewProvider
      quoteId={quote.id}
      canWrite={canReview}
      lineIds={lines.filter((l) => l.id).map((l) => l.id as string)}
      sectionTitles={sectionTitles}
      people={people}
      meId={me.id}
      tz={tz}
      onChange={setOpenComments}
    >
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/quotes" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink" aria-label="Về danh sách báo giá">
            <Icon name="chevronRight" className="rotate-180" />
          </Link>
          <h1 className="flex flex-wrap items-center gap-2.5 text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">
            {quote.code} <StatusBadge status={quote.status} />
            {quote.source === 'import' && <Badge tone="neutral">Lịch sử (import)</Badge>}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {editable && (
            <span className="text-[13px] text-ink-3" aria-live="polite">
              {saveState === 'saving' ? 'Đang lưu…' : saveState === 'dirty' ? 'Chưa lưu' : saveState === 'error' ? 'Lỗi lưu' : 'Đã lưu'}
            </span>
          )}
          <div className="flex flex-wrap items-baseline gap-x-2 leading-tight [&>*]:whitespace-nowrap">
            <Icon name="clock" size={15} className={`self-center ${elapsed > (settings?.quote_late_hours ?? 8) ? 'text-bad' : 'text-ink-3'}`} />
            <span className="text-[13px] text-ink-3">Thời gian xử lý (giờ làm việc)</span>
            <b className={`text-[17px] font-semibold ${elapsed > (settings?.quote_late_hours ?? 8) ? 'text-bad' : 'text-ink'}`}>{fmtNum(elapsed, 2)} giờ</b>
            <span className="text-[13px] text-ink-3">· mục tiêu ≤ {settings?.quote_late_hours ?? 8} giờ</span>
          </div>
          <Button variant="secondary" size="sm" icon="link" onClick={copyLink}>
            Sao chép link
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Báo giá" className="flex min-w-0 flex-[999_1_920px] flex-col gap-5 rounded-xl border border-line bg-white p-6 shadow-sheet">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Kính gửi (khách hàng)">{(fid) => <Input id={fid} value={header.client} disabled={!editable} onChange={(e) => setH({ client: e.target.value })} placeholder="Tên khách / thương hiệu" />}</Field>
            <Field label="Người liên hệ">{(fid) => <Input id={fid} value={header.contact} disabled={!editable} onChange={(e) => setH({ contact: e.target.value })} placeholder="Họ tên, SĐT" />}</Field>
            <Field label="Dự án">{(fid) => <Input id={fid} value={header.project} disabled={!editable} onChange={(e) => setH({ project: e.target.value })} placeholder="VD: Lễ khai giảng 2026" />}</Field>
            <Field label="Địa điểm">{(fid) => <Input id={fid} value={header.venue} disabled={!editable} onChange={(e) => setH({ venue: e.target.value })} placeholder="VD: Khách sạn 5 sao, Đà Nẵng" />}</Field>
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

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-end gap-1 text-[13px] text-ink-3">
              <span>Góp ý phần thông tin khách hàng</span>
              <CommentToggle target={{ anchor: 'client' }} label={ANCHOR_LABEL.client} />
            </div>
            <AnchorThreads target={{ anchor: 'client' }} label={ANCHOR_LABEL.client} />
          </div>

          <div className="relative overflow-x-auto">
            <table className="quote-lines w-full border-separate border-spacing-0 text-[15px] sm:min-w-[820px]">
              <thead>
                <tr className="whitespace-nowrap text-left">
                  <th className="w-12 border-b-2 border-ink px-2 py-2.5 text-center">STT</th>
                  <th className="min-w-[260px] border-b-2 border-ink px-3 py-2.5">Hạng mục / phạm vi</th>
                  <th className="border-b-2 border-ink px-3 py-2.5">Đơn vị</th>
                  <th className="w-24 min-w-[88px] border-b-2 border-ink px-3 py-2.5 text-center">SL</th>
                  <th className="border-b-2 border-ink px-3 py-2.5 text-right">Đơn giá (đ)</th>
                  <th className="border-b-2 border-ink px-3 py-2.5 text-right">Thành tiền (đ)</th>
                  <th className="w-11 border-b-2 border-ink px-1 py-2.5">
                    <span className="sr-only">Xoá</span>
                  </th>
                </tr>
              </thead>
              {!sectionTitles.length && (
                <tbody>
                  <tr>
                    <td colSpan={7} className="border-b border-line-soft px-3 py-6 text-ink-3">
                      Chưa có hạng mục. Thêm từ Thư viện giá (mỗi nhóm dịch vụ thành một phần), hoặc chép từ một báo giá tương tự bên phải.
                      {editable && (
                        <div className="mt-3">
                          <Button variant="accent" icon="plus" onClick={() => setPickerFor(pickerFor === AUTO_SECTION ? null : AUTO_SECTION)} aria-expanded={pickerFor === AUTO_SECTION}>
                            Thêm hạng mục từ Thư viện giá
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {editable && pickerFor === AUTO_SECTION && (
                    <tr>
                      <td colSpan={7} className="border-b border-line-soft px-3 pb-4">
                        <LibraryPicker library={library} lines={lines} usage={usage} preferredGroup={header.service_group} onAdd={(it) => addItem(it, AUTO_SECTION)} onClose={() => setPickerFor(null)} />
                      </td>
                    </tr>
                  )}
                </tbody>
              )}
              {sectionTitles.map((title, si) => {
                const sec = grouped.find((g) => g.title === title);
                const rows = sec ? sec.lines : [];
                const before = grouped.slice(0, grouped.findIndex((g) => g.title === title)).reduce((n, g) => n + g.lines.length, 0);
                return (
                  <tbody key={title}>
                    <tr data-row="section" className="bg-canvas">
                      <td colSpan={5} className="border-b border-line px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <b className="w-6 shrink-0 text-center font-semibold text-ink-3">{toRoman(si + 1)}</b>
                          {editable ? (
                            <input
                              aria-label={`Tên phần ${toRoman(si + 1)}`}
                              defaultValue={title}
                              key={title}
                              onBlur={(e) => {
                                if (e.target.value.trim() && e.target.value.trim() !== title) renameSection(title, e.target.value);
                                else e.target.value = title;
                              }}
                              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                              className="h-9 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 font-semibold text-ink transition-colors hover:border-line focus:border-brand focus:bg-white focus:outline-none"
                            />
                          ) : (
                            <b className="font-semibold text-ink">{title}</b>
                          )}
                          {sec && <CommentToggle target={{ anchor: 'section', sectionTitle: title }} label={`Phần ${toRoman(si + 1)} · ${title}`} className="shrink-0" />}
                        </div>
                      </td>
                      <td className="whitespace-nowrap border-b border-line px-3 py-1.5 text-right font-semibold tabular-nums">{fmtVnd(sec?.amount ?? 0, false)}</td>
                      <td className="border-b border-line px-1 py-1">
                        {editable && <IconButton icon="trash" label={`Xoá phần ${title}`} onClick={() => removeSection(title)} />}
                      </td>
                    </tr>
                    {sec && <CommentTableRow target={{ anchor: 'section', sectionTitle: title }} label={`Phần ${toRoman(si + 1)} · ${title}`} colSpan={7} />}
                    {rows.map(({ line: l }, k) => {
                      const lp = libPrice(l);
                      const pass = l.kind === 'pass_through';
                      const custom = !pass && lp !== null && l.unit_price !== lp;
                      const lineLabel = `Dòng ${before + k + 1} · ${l.item_name}`;
                      const idx = lines.indexOf(l);
                      const shownBand = band ?? quote.band_detail ?? null;
                      const flagged = !!shownBand?.reasons.some((r) => (r.code === 'deviation' || r.code === 'no_library_price') && r.line === idx);
                      return (
                        <Fragment key={l.key}>
                        <tr data-row="line" className="align-top">
                          <td data-cell="no" className="border-b border-line-soft px-1 py-3 pt-[18px] text-center text-ink-3">
                            {before + k + 1}
                            {/* First column, so the comment button stays in view when the table scrolls sideways. */}
                            {l.id && <CommentToggle target={{ anchor: 'line', lineId: l.id }} label={lineLabel} className="mx-auto mt-1" />}
                          </td>
                          <td data-cell="item" className="border-b border-line-soft px-3 py-2.5">
                            <div className="font-medium">{l.item_name}</div>
                            <div className="text-[13px] text-ink-3">
                              {l.library_item_id ? libMap.get(l.library_item_id)?.service_group : 'Không thuộc thư viện'}
                              {pass && ' · chi hộ: không chiết khấu, không xét khung giá'}
                              {lp !== null && custom && ` · giá thư viện ${fmtVnd(lp)}`}
                            </div>
                            {(editable || l.description) && (
                              <textarea
                                aria-label={`Phạm vi công việc: ${l.item_name}`}
                                rows={2}
                                value={l.description ?? ''}
                                disabled={!editable}
                                placeholder="Mô tả phạm vi (in nghiêng dưới tên hạng mục)"
                                onChange={(e) => setLine(l.key, { description: e.target.value })}
                                className="mt-1.5 w-full resize-y rounded-lg border border-line-soft bg-canvas/50 px-2 py-1.5 text-[13.5px] italic text-ink-2 placeholder:text-ink-3 focus:border-brand focus:bg-white focus:outline-none disabled:resize-none disabled:border-transparent disabled:bg-transparent disabled:px-0"
                              />
                            )}
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
                            {editable && sectionTitles.length > 1 && (
                              <select
                                aria-label={`Chuyển ${l.item_name} sang phần khác`}
                                value=""
                                onChange={(e) => e.target.value && moveLine(l.key, e.target.value)}
                                className="mt-1.5 h-8 rounded-md border border-line-soft bg-white px-1.5 text-[12.5px] text-ink-3"
                              >
                                <option value="">Chuyển sang phần…</option>
                                {sectionTitles
                                  .filter((t) => t !== title)
                                  .map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </td>
                          <td data-cell="unit" className="whitespace-nowrap border-b border-line-soft px-3 py-2.5 pt-[18px] text-ink-2">{l.unit}</td>
                          <td data-cell="qty" className="border-b border-line-soft px-3 py-2.5">
                            <span className="mb-1 block text-[12px] text-ink-3 sm:hidden">Số lượng ({l.unit})</span>
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              aria-label={`Số lượng: ${l.item_name}`}
                              value={l.qty}
                              disabled={!editable}
                              onChange={(e) => setLine(l.key, { qty: Math.max(0, Number(e.target.value) || 0) })}
                              className="h-10 w-full rounded-lg border border-line bg-white text-center font-semibold focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 disabled:border-transparent disabled:bg-canvas"
                            />
                          </td>
                          <td data-cell="price" className="border-b border-line-soft px-3 py-2.5">
                            <span className="mb-1 block text-right text-[12px] text-ink-3 sm:hidden">Đơn giá (đ)</span>
                            <div className="flex flex-col items-end gap-1.5">
                              <input
                                inputMode="numeric"
                                aria-label={`Đơn giá: ${l.item_name}`}
                                value={fmtVnd(l.unit_price, false)}
                                disabled={!editable}
                                onChange={(e) => setLine(l.key, { unit_price: parseMoney(e.target.value) })}
                                className={`h-10 w-full rounded-lg border px-2.5 sm:w-36 text-right tabular-nums focus:outline-none focus:ring-[3px] focus:ring-brand/15 disabled:border-transparent disabled:bg-canvas ${flagged ? 'border-accent-line bg-accent-soft/40 focus:border-accent' : 'border-line bg-white focus:border-brand'}`}
                              />
                              <BandRuler unitPrice={l.unit_price} libraryPrice={lp} kind={l.kind} flagged={flagged} />
                            </div>
                          </td>
                          <td data-cell="total" className="whitespace-nowrap border-b border-line-soft px-3 py-2.5 pt-[18px] text-right font-semibold tabular-nums">
                            <span className="mr-2 font-normal text-ink-3 sm:hidden">Thành tiền</span>
                            {fmtVnd(Math.round(l.qty * l.unit_price), false)}
                          </td>
                          <td data-cell="del" className="border-b border-line-soft px-1 py-1.5">
                            {editable && <IconButton icon="x" label={`Xoá dòng ${l.item_name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}
                          </td>
                        </tr>
                        {l.id && <CommentTableRow target={{ anchor: 'line', lineId: l.id }} label={lineLabel} colSpan={7} />}
                        </Fragment>
                      );
                    })}
                    {editable && (
                      <tr>
                        <td colSpan={7} className="border-b border-line-soft px-3 py-2">
                          {pickerFor === title ? (
                            <LibraryPicker
                              library={library}
                              lines={lines.filter((l) => sectionOf(l) === title)}
                              usage={usage}
                              preferredGroup={header.service_group}
                              onAdd={(it) => addItem(it, title)}
                              onClose={() => setPickerFor(null)}
                            />
                          ) : (
                            <button type="button" onClick={() => setPickerFor(title)} className="flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-[14px] font-semibold text-brand transition-colors hover:bg-brand-soft">
                              <Icon name="plus" size={16} /> Thêm hạng mục vào phần {toRoman(si + 1)}
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>

          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              {newSection === null ? (
                <Button variant="accent" icon="plus" onClick={() => setNewSection('')}>
                  Thêm phần mới
                </Button>
              ) : (
                <>
                  <Input
                    aria-label="Tên phần mới"
                    autoFocus
                    value={newSection}
                    placeholder="VD: Dịch vụ quảng cáo"
                    onChange={(e) => setNewSection(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addSection();
                      if (e.key === 'Escape') setNewSection(null);
                    }}
                    className="max-w-xs"
                  />
                  <Button onClick={addSection} disabled={!newSection.trim()}>
                    Thêm
                  </Button>
                  <Button variant="ghost" onClick={() => setNewSection(null)}>
                    Huỷ
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <div className="flex w-full max-w-[460px] flex-col gap-2 text-[15px]">
              <div className="flex justify-between border-t-2 border-ink pt-3">
                <span className="text-ink-2">Cộng tiền hàng</span>
                <b className="font-semibold tabular-nums">{fmtVnd(totals.subtotal)}</b>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="discount" className="text-ink-2">
                  Chiết khấu (%){totals.passThrough > 0 && <span className="block text-[12px] text-ink-3">không áp cho khoản chi hộ</span>}
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
                    className="h-10 w-20 rounded-lg border border-line bg-white text-center font-semibold focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 disabled:border-transparent disabled:bg-canvas"
                  />
                  <span className="min-w-[120px] text-right tabular-nums">− {fmtVnd(totals.discountAmount)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="vat" className="text-ink-2">
                  Thuế GTGT (%)
                  {totals.passThrough > 0 && !vatOnPassThrough && <span className="block text-[12px] text-ink-3">không tính trên khoản chi hộ</span>}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="vat"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={header.vat_pct}
                    disabled={!editable}
                    onChange={(e) => setH({ vat_pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                    className="h-10 w-20 rounded-lg border border-line bg-white text-center font-semibold focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 disabled:border-transparent disabled:bg-canvas"
                  />
                  <span className="min-w-[120px] text-right tabular-nums">{fmtVnd(totals.vatAmount)}</span>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 rounded-lg bg-accent-strong px-4 py-2.5 text-white">
                <b className="text-[16px] font-semibold">Tổng thanh toán</b>
                <b className="text-[22px] font-semibold tracking-[-0.01em] tabular-nums">{fmtVnd(totals.grandTotal)}</b>
              </div>
              <Button variant="secondary" icon="file" onClick={() => setPreview(true)} disabled={!lines.length}>
                Xem trước báo giá (PDF)
              </Button>
              <div className="flex items-center justify-end gap-1 text-[13px] text-ink-3">
                <span>Góp ý chiết khấu, thuế, tổng tiền</span>
                <CommentToggle target={{ anchor: 'totals' }} label={ANCHOR_LABEL.totals} />
              </div>
              <AnchorThreads target={{ anchor: 'totals' }} label={ANCHOR_LABEL.totals} />
            </div>
          </div>

          <div className="border-t border-line pt-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[17px] font-semibold text-ink">Điều khoản và ghi chú</h2>
              <CommentToggle target={{ anchor: 'terms' }} label={ANCHOR_LABEL.terms} />
            </div>
            <p className="mt-0.5 text-[13px] text-ink-3">Tick để đưa vào báo giá. Điều khoản mẫu do PM quản lý ở trang Thư viện giá.</p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {libraryTerms.map((t) => (
                <li key={t.id}>
                  <label className="flex items-start gap-2.5 text-[14.5px]">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={header.terms.includes(t.text)} disabled={!editable} onChange={(e) => toggleTerm(t.text, e.target.checked)} />
                    <span>{t.text}</span>
                  </label>
                </li>
              ))}
              {customTerms.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[14.5px]">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked disabled={!editable} onChange={() => toggleTerm(t, false)} aria-label={`Bỏ điều khoản: ${t}`} />
                  <span>
                    {t} <span className="text-[12px] text-ink-3">(riêng báo giá này)</span>
                  </span>
                </li>
              ))}
            </ul>
            {editable && (
              <div className="mt-3 flex gap-2">
                <Input aria-label="Thêm điều khoản riêng" value={customTerm} placeholder="Thêm điều khoản riêng cho báo giá này" onChange={(e) => setCustomTerm(e.target.value)} onKeyDown={(e) => {
                  if (e.key === 'Enter' && customTerm.trim()) {
                    toggleTerm(customTerm.trim(), true);
                    setCustomTerm('');
                  }
                }} />
                <Button
                  variant="secondary"
                  disabled={!customTerm.trim()}
                  onClick={() => {
                    toggleTerm(customTerm.trim(), true);
                    setCustomTerm('');
                  }}
                >
                  Thêm
                </Button>
              </div>
            )}
            <AnchorThreads target={{ anchor: 'terms' }} label={ANCHOR_LABEL.terms} className="mt-3" />
          </div>

          {/* ---------------- status panels ---------------- */}
          {quote.status === 'changes_requested' && lastDecision?.decision === 'changes' && (
            <Banner tone="bad" title={`${ROLE_LABEL[lastDecision.level]} yêu cầu sửa`}>
              “{lastDecision.comment}” — {personName(people, lastDecision.approver_id)}, {fmtVnDateTime(lastDecision.decided_at, tz)}.
              {openComments > 0 ? ` Còn ${openComments} góp ý đang mở, ghi ngay tại dòng cần sửa. Sửa xong, trả lời hoặc đánh dấu "Đã xử lý" rồi gửi lại.` : ' Sửa báo giá rồi gửi lại.'}
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
                    <Button variant="success" icon="send" busy={busy === 'send'} disabled={!!problems.length || saveState === 'saving' || !sendBlock.ok} onClick={sendNow}>
                      Xuất PDF & gửi
                    </Button>
                  }
                >
                  Chiết khấu {fmtNum(band.discountPct, 1)}% · đơn giá lệch thư viện nhiều nhất {fmtNum(band.maxDeviationPct, 1)}%
                  {!sendBlock.ok && <div className="mt-1 font-semibold">{sendBlock.error}</div>}
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
              {isOwner && ' Gửi link báo giá cho người duyệt để họ xem và góp ý ngay trên báo giá.'}
              <BandReasons band={quote.band_detail} />
            </Banner>
          )}
          {canDecide && (
            <Card
              title="Quyết định của bạn"
              subtitle={
                openComments > 0
                  ? `Đang có ${openComments} góp ý mở. Chọn Yêu cầu sửa để trả về Account, hoặc đánh dấu đã xử lý hết rồi Duyệt.`
                  : 'Chỗ nào chưa ổn, bấm biểu tượng góp ý ở đúng dòng đó rồi chọn Yêu cầu sửa. Ổn hết thì Duyệt.'
              }
            >
              <div className="flex flex-wrap gap-2">
                <Button icon="check" disabled={openComments > 0} title={openComments > 0 ? 'Còn góp ý chưa xử lý' : undefined} onClick={() => setDecision({ kind: 'approve', comment: '' })}>
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
                    <Button variant="success" icon="send" busy={busy === 'send'} disabled={!sendBlock.ok} onClick={sendNow}>
                      Xuất PDF & gửi
                    </Button>
                  </>
                )
              }
            >
              {lastDecision?.comment && `“${lastDecision.comment}” — `}
              {lastDecision && `${personName(people, lastDecision.approver_id)}, ${fmtVnDateTime(lastDecision.decided_at, tz)}`}
              {!sendBlock.ok && <div className="mt-1 font-semibold">{sendBlock.error}</div>}
            </Banner>
          )}
          {quote.status === 'sent' && (
            <div className="border-t-2 border-rail pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-rail">
                <span>Đã gửi {quote.client} · {quote.sent_at && fmtVnDateTime(quote.sent_at, tz)}</span>
                <span>Xử lý trong {fmtNum(elapsed, 2)} giờ làm việc</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
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

        <div className="flex min-w-0 flex-[1_1_320px] flex-wrap content-start gap-4 [&>*]:flex-[1_1_320px]">
        <ReviewCard quoteId={quote.id} code={quote.code} locked={quote.status === 'sent'} />
        <aside aria-label="Báo giá tương tự" className="flex min-w-0 flex-col gap-0 border-t border-ink pt-3.5">
          <div className="mb-1">
            <h2 className="text-[17px] font-semibold text-ink">Báo giá tương tự đã gửi</h2>
            <p className="mt-0.5 text-[13.5px] text-ink-3">Từ Kho tham chiếu · cùng nhóm dịch vụ trước, rồi theo số hạng mục trùng</p>
          </div>
          {!similar.length && <p className="text-sm text-ink-3">Chưa có báo giá tương tự. Chọn nhóm dịch vụ hoặc thêm hạng mục để gợi ý.</p>}
          {similar.map(({ q, sharedItems, sameGroup }) => (
            <SimilarCard key={q.id} q={q} sharedItems={sharedItems} sameGroup={sameGroup} tz={tz} editable={editable} hasLines={lines.length > 0} onAdd={(mode) => addFrom(q, mode)} />
          ))}
        </aside>
        </div>
      </div>

      <div aria-hidden="true" style={{ position: 'fixed', left: '-10000px', top: 0 }}>
        <QuotePdf ref={pdfRef} quote={pdfQuote} lines={pdfLines} company={company} preparedBy={accountName} tz={tz} vatOnPassThrough={vatOnPassThrough} />
      </div>

      <Modal open={preview} onClose={() => setPreview(false)} title={`Xem trước ${quote.code}`} wide>
        <div className="relative overflow-x-auto">
          <div className="mx-auto w-[190mm] shadow-sm ring-1 ring-line-soft">
            <QuotePdf quote={pdfQuote} lines={pdfLines} company={company} preparedBy={accountName} tz={tz} vatOnPassThrough={vatOnPassThrough} />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={decision?.kind === 'approve' ? `Duyệt ${quote.code}` : `Yêu cầu sửa ${quote.code}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>
              Huỷ
            </Button>
            <Button
              busy={busy === 'decide'}
              disabled={decision?.kind === 'changes' ? !requestChangesGate(decision.comment, openComments).ok : !approveGate(openComments).ok}
              onClick={decide}
            >
              {decision?.kind === 'approve' ? 'Duyệt báo giá' : 'Gửi yêu cầu sửa'}
            </Button>
          </>
        }
      >
        {decision?.kind === 'changes' && openComments > 0 && (
          <p className="mb-3 rounded-lg bg-warn-soft/50 px-3 py-2 text-[14px] text-warn">Account sẽ thấy {openComments} góp ý bạn đã ghi trên báo giá, ngay tại dòng cần sửa.</p>
        )}
        <Field label={decision?.kind === 'approve' ? 'Nhận xét (không bắt buộc)' : openComments > 0 ? 'Nhận xét chung (không bắt buộc)' : 'Cần sửa gì? (bắt buộc, hoặc góp ý trực tiếp trên từng dòng)'}>
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
    </ReviewProvider>
  );
}

function SimilarCard({
  q,
  sharedItems,
  sameGroup,
  tz,
  editable,
  hasLines,
  onAdd,
}: {
  q: ArchiveEntry;
  sharedItems: number;
  sameGroup: boolean;
  tz: string;
  editable: boolean;
  hasLines: boolean;
  onAdd: (mode: 'append' | 'replace') => void;
}) {
  const [open, setOpen] = useState(false);
  const items = [...q.quote_lines].sort((a, b) => a.position - b.position);
  return (
    <div className="flex flex-col gap-1.5 border-b border-line-soft py-3.5 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <Link to={`/quotes/${q.id}`} className="whitespace-nowrap font-semibold text-brand underline-offset-[3px] hover:underline">
          {q.code}
        </Link>
        <span className="whitespace-nowrap text-[12px] text-ink-3">
          {sameGroup ? 'Cùng nhóm' : 'Khác nhóm'} · {sharedItems} hạng mục trùng
        </span>
      </div>
      <div className="text-[14.5px] font-medium leading-snug text-ink">{q.client}</div>
      <div className="text-[13.5px] text-ink-3">
        <span className="whitespace-nowrap">{fmtVnDate(q.sent_at, tz)}</span> · <span className="whitespace-nowrap font-semibold text-ink-2">{fmtVnd(q.total)}</span>
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[34px] items-center justify-between rounded-lg border border-line px-3 text-left text-[13.5px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
      >
        <span>{open ? 'Ẩn' : 'Xem'} {items.length} hạng mục</span>
        <span className={cx('transition-transform', open && 'rotate-180')}><Icon name="chevronDown" size={16} /></span>
      </button>
      {open && (
        <ul className="flex flex-col divide-y divide-line-soft text-[13.5px]">
          {items.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0 leading-snug">
                <span className="tabular-nums text-ink-3">{Number(l.qty)} ×</span> {l.item_name}
                {!l.library_item_id && <span className="ml-1 text-[12px] text-ink-3">(ngoài thư viện, không chép)</span>}
              </span>
              <span className="shrink-0 tabular-nums text-ink-3">{fmtVnd(Number(l.unit_price) * Number(l.qty))}</span>
            </li>
          ))}
          <li className="pt-1.5 text-[12px] text-ink-3">Giá trên là giá lúc gửi; khi thêm vào báo giá này, giá lấy theo thư viện hôm nay.</li>
        </ul>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon="plus" className="flex-1" onClick={() => onAdd('append')}>
            Thêm tất cả {items.length} hạng mục
          </Button>
          {hasLines && (
            <button type="button" onClick={() => onAdd('replace')} className="min-h-[36px] px-2 text-[13px] font-semibold text-ink-3 underline hover:text-ink">
              Thay toàn bộ
            </button>
          )}
        </div>
      )}
    </div>
  );
}
