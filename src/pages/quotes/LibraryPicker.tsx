import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { cx, Icon } from '@/components/ui';
import { fmtVnd } from '@/lib/format';
import { searchScore } from '@/lib/search';
import type { LibraryItem } from './data';

const POPULAR = '__popular__';
const ALL = '__all__';
const POPULAR_LIMIT = 10;

interface Props {
  library: LibraryItem[];
  /** Lines already in the quote, to show "đã có · SL n" on matching items. */
  lines: { library_item_id: string | null; qty: number }[];
  /** How many sent quotes in the Reference Archive used each library item. */
  usage: Map<string, number>;
  /** The quote's service group: listed first. */
  preferredGroup: string | null;
  onAdd: (item: LibraryItem) => void;
  onClose: () => void;
}

/**
 * Picks Pricing Library items for a quote. Built for a library of dozens of items: accent-insensitive
 * search over name, code, group and unit; filter by group or "Hay dùng"; results grouped under sticky
 * headers; several items can be added without reopening; keyboard ↑ ↓ Enter Esc.
 */
export function LibraryPicker({ library, lines, usage, preferredGroup, onAdd, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>(ALL);
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => library.filter((i) => i.active), [library]);

  const groups = useMemo(() => {
    const count = new Map<string, number>();
    for (const i of items) count.set(i.service_group, (count.get(i.service_group) ?? 0) + 1);
    return [...count.entries()]
      .sort(([a], [b]) => (a === preferredGroup ? -1 : b === preferredGroup ? 1 : a.localeCompare(b, 'vi')))
      .map(([name, n]) => ({ name, n }));
  }, [items, preferredGroup]);

  const popularIds = useMemo(
    () =>
      new Set(
        items
          .filter((i) => (usage.get(i.id) ?? 0) > 0)
          .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name, 'vi'))
          .slice(0, POPULAR_LIMIT)
          .map((i) => i.id),
      ),
    [items, usage],
  );

  const inQuote = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) if (l.library_item_id) m.set(l.library_item_id, (m.get(l.library_item_id) ?? 0) + l.qty);
    return m;
  }, [lines]);

  const searching = query.trim().length > 0;
  const groupOrder = useMemo(() => new Map(groups.map((g, i) => [g.name, i])), [groups]);

  /** Visible items, in display order, with the group header to show before each run. */
  const rows = useMemo(() => {
    let pool = items;
    if (group === POPULAR) pool = pool.filter((i) => popularIds.has(i.id));
    else if (group !== ALL) pool = pool.filter((i) => i.service_group === group);
    if (searching) {
      return pool
        .map((i) => ({ i, s: searchScore(query, i.name, [i.code ?? '', i.service_group, i.unit]) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.i.name.localeCompare(b.i.name, 'vi'))
        .map((x) => x.i);
    }
    if (group === POPULAR) return [...pool].sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0));
    return [...pool].sort((a, b) => (groupOrder.get(a.service_group) ?? 0) - (groupOrder.get(b.service_group) ?? 0) || a.name.localeCompare(b.name, 'vi'));
  }, [items, group, popularIds, searching, query, usage, groupOrder]);

  const showHeaders = !searching && group === ALL;

  useEffect(() => setActive(0), [query, group]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function add(item: LibraryItem) {
    onAdd(item);
    setAdded((n) => n + 1);
    setFlash(item.id);
    window.setTimeout(() => setFlash((f) => (f === item.id ? null : f)), 900);
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) add(rows[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else onClose();
    }
  }

  const chip = (value: string, label: string, n: number, icon?: string) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setGroup(value);
        inputRef.current?.focus();
      }}
      aria-pressed={group === value}
      className={cx(
        'inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-semibold transition-colors',
        group === value ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-2 hover:border-brand-line hover:text-ink',
      )}
    >
      {icon && <Icon name={icon} size={14} />}
      {label}
      <span className={cx('tabular-nums', group === value ? 'text-white/75' : 'text-ink-3')}>{n}</span>
    </button>
  );

  const listId = 'library-picker-list';
  let lastGroup: string | null = null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-brand-line bg-white shadow-[0_6px_24px_-12px_rgba(24,0,173,0.35)]">
      <div className="flex flex-col gap-3 border-b border-line-soft bg-[#FBFAFE] p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Tìm theo tên, mã, nhóm…"
              aria-label="Tìm hạng mục trong Thư viện giá"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={rows[active] ? `lp-${rows[active].id}` : undefined}
              className="min-h-[44px] w-full rounded-lg border-[1.5px] border-line bg-white pl-10 pr-10 text-[15px] text-ink placeholder:text-ink-3/70 focus:border-brand focus:outline-none"
            />
            {query && (
              <button type="button" aria-label="Xoá ô tìm" onClick={() => { setQuery(''); inputRef.current?.focus(); }} className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-canvas hover:text-ink">
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-[10px] bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-dark">
            Xong
          </button>
        </div>
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 sm:flex-wrap sm:overflow-visible" role="group" aria-label="Lọc theo nhóm dịch vụ">
          {chip(ALL, 'Tất cả', items.length)}
          {popularIds.size > 0 && chip(POPULAR, 'Hay dùng', popularIds.size, 'clock')}
          {groups.map((g) => chip(g.name, g.name, g.n))}
        </div>
      </div>

      <div ref={listRef} id={listId} role="listbox" aria-label="Hạng mục" className="max-h-[min(440px,55vh)] overflow-y-auto overscroll-contain">
        {rows.map((i, idx) => {
          const header = showHeaders && i.service_group !== lastGroup ? i.service_group : null;
          lastGroup = i.service_group;
          const qty = inQuote.get(i.id);
          const isActive = idx === active;
          return (
            <div key={i.id}>
              {header && (
                <div className="sticky top-0 z-10 flex items-baseline justify-between border-b border-line-soft bg-white/95 px-4 pb-1.5 pt-3 backdrop-blur">
                  <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-2">
                    {header}
                    {header === preferredGroup && <span className="ml-2 normal-case tracking-normal text-brand">· nhóm của báo giá</span>}
                  </span>
                  <span className="text-[12px] tabular-nums text-ink-3">{groups.find((g) => g.name === header)?.n}</span>
                </div>
              )}
              <div
                id={`lp-${i.id}`}
                data-idx={idx}
                role="option"
                aria-selected={isActive}
                onMouseMove={() => !isActive && setActive(idx)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(i)}
                className={cx(
                  'group flex cursor-pointer items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-b-0',
                  isActive ? 'bg-brand-soft' : 'bg-white',
                  flash === i.id && 'bg-ok-soft',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 font-semibold leading-snug text-ink sm:truncate" title={i.name}>
                    {i.name}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
                    <span className="font-semibold tabular-nums text-ink-2 sm:hidden">
                      {fmtVnd(i.unit_price)} / {i.unit}
                    </span>
                    {i.code && <span className="hidden font-mono text-[11.5px] sm:inline">{i.code}</span>}
                    {!showHeaders && <span>· {i.service_group}</span>}
                    {group === POPULAR && <span>· dùng trong {usage.get(i.id)} báo giá</span>}
                  </div>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <div className="font-semibold tabular-nums text-ink">{fmtVnd(i.unit_price)}</div>
                  <div className="text-[12.5px] text-ink-3">/ {i.unit}</div>
                </div>
                <div className="flex shrink-0 justify-end sm:w-[118px]">
                  {qty ? (
                    <span className={cx('inline-flex min-h-[36px] items-center gap-1 rounded-full px-2.5 text-[12.5px] font-semibold', flash === i.id ? 'bg-ok text-white' : 'bg-ok-soft text-ok-ink')}>
                      <Icon name="check" size={14} />
                      <span className="hidden sm:inline">Đã có · </span>SL {qty}
                    </span>
                  ) : (
                    <span className={cx('inline-flex min-h-[36px] min-w-[36px] items-center justify-center gap-1 rounded-full border px-2 text-[12.5px] font-semibold sm:px-2.5', isActive ? 'border-brand bg-brand text-white' : 'border-line text-brand group-hover:border-brand')}>
                      <Icon name="plus" size={14} />
                      <span className="hidden sm:inline">Thêm</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className="px-4 py-8 text-center text-sm text-ink-3">
            Không có hạng mục khớp “{query}”{group !== ALL && ' trong nhóm đang lọc'}.
            {group !== ALL && (
              <button type="button" className="ml-1 font-semibold text-brand underline" onClick={() => setGroup(ALL)}>
                Tìm trong tất cả nhóm
              </button>
            )}
            <div className="mt-1">Chưa có trong thư viện thì nhờ PM thêm vào Thư viện giá.</div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft bg-[#FBFAFE] px-4 py-2 text-[12.5px] text-ink-3">
        <span className="hidden sm:inline">
          <kbd className="rounded border border-line bg-white px-1">↑</kbd> <kbd className="rounded border border-line bg-white px-1">↓</kbd> chọn ·{' '}
          <kbd className="rounded border border-line bg-white px-1">Enter</kbd> thêm · <kbd className="rounded border border-line bg-white px-1">Esc</kbd> đóng · gõ không dấu cũng được · bấm lại mục đã có để +1 SL
        </span>
        <span className="tabular-nums" aria-live="polite">
          {rows.length}/{items.length} hạng mục{added > 0 && <b className="ml-2 text-ok-ink">· đã thêm {added} lần</b>}
        </span>
      </div>
    </div>
  );
}
