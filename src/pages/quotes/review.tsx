// Review on the quote itself: comment threads pinned to a line, a section or a block of the quote.
// Reading goes straight to the table (RLS); writing goes through the Edge Function.
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildThreads, CommentAnchor, COMMENT_MAX_LENGTH, ReviewComment, ReviewThread, ROLE_LABEL, Role, threadPlacement } from '@/domain';
import { Button, cx, Icon, useToast } from '@/components/ui';
import { callApi } from '@/lib/api';
import { fmtVnDateTime } from '@/lib/format';
import { check, supabase } from '@/lib/supabase';
import { personName } from './data';

interface CommentRow {
  id: string;
  quote_id: string;
  parent_id: string | null;
  author_id: string;
  anchor: CommentAnchor;
  line_id: string | null;
  section_title: string | null;
  anchor_label: string;
  body: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

const COMMENT_COLS = 'id, quote_id, parent_id, author_id, anchor, line_id, section_title, anchor_label, body, resolved_at, resolved_by, created_at';

function toReview(r: CommentRow): ReviewComment {
  return {
    id: r.id,
    parentId: r.parent_id,
    authorId: r.author_id,
    anchor: r.anchor,
    lineId: r.line_id,
    sectionTitle: r.section_title,
    anchorLabel: r.anchor_label,
    body: r.body,
    resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by,
    createdAt: r.created_at,
  };
}

export async function loadComments(quoteId: string): Promise<ReviewComment[]> {
  return (check(await supabase.from('quote_comments').select(COMMENT_COLS).eq('quote_id', quoteId).order('created_at')) as CommentRow[]).map(toReview);
}

/** Open (not yet handled) comment threads per quote, for lists. */
export async function loadOpenCounts(quoteIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!quoteIds.length) return out;
  const rows = check(await supabase.from('quote_comments').select('quote_id').in('quote_id', quoteIds).is('parent_id', null).is('resolved_at', null)) as { quote_id: string }[];
  for (const r of rows) out.set(r.quote_id, (out.get(r.quote_id) ?? 0) + 1);
  return out;
}

/** Link to a quote that can be pasted into Lark or Zalo; the receiver signs in and lands on the quote. */
export function quoteLink(quoteId: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}quotes/${quoteId}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and non-secure pages: fall back to a hidden field.
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  }
}

export type AnchorTarget = { anchor: Exclude<CommentAnchor, 'line' | 'section'> } | { anchor: 'line'; lineId: string } | { anchor: 'section'; sectionTitle: string };

export function anchorKey(t: AnchorTarget): string {
  return t.anchor === 'line' ? `line:${t.lineId}` : t.anchor === 'section' ? `section:${t.sectionTitle}` : t.anchor;
}

type People = Map<string, { full_name: string; email: string; role: string }>;

interface ReviewState {
  threads: ReviewThread[];
  /** Threads by the place they show at (a deleted line's comments fall back to "general"). */
  byKey: Map<string, ReviewThread[]>;
  openCount: number;
  resolvedCount: number;
  canWrite: boolean;
  /** Places the reader opened by hand (also shows their handled comments and the composer). */
  expanded: Set<string>;
  toggle: (key: string, on?: boolean) => void;
  /** Opens a place and scrolls to it. */
  focus: (key: string) => void;
  post: (target: AnchorTarget | { parentId: string }, body: string) => Promise<boolean>;
  resolve: (commentId: string, resolved: boolean) => Promise<void>;
  people: People;
  meId: string;
  tz: string;
  busy: boolean;
  error: unknown;
}

const Ctx = createContext<ReviewState | null>(null);

export function useReview(): ReviewState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReview outside ReviewProvider');
  return v;
}

/**
 * Loads the quote's comments, re-reads them every 20 seconds while the tab is visible (so the Account
 * sees the PM's comments arrive without reloading), and offers the two write actions.
 */
export function ReviewProvider({
  quoteId,
  canWrite,
  lineIds,
  sectionTitles,
  people,
  meId,
  tz,
  onChange,
  children,
}: {
  quoteId: string;
  canWrite: boolean;
  lineIds: string[];
  sectionTitles: string[];
  people: People;
  meId: string;
  tz: string;
  /** Called after each refresh with the number of open threads. */
  onChange?: (open: number) => void;
  children: ReactNode;
}) {
  const toast = useToast();
  const [comments, setComments] = useState<ReviewComment[]>([]);
  // Names of people who are not in the list the page loaded at open (e.g. an account created after
  // the Account opened this tab): fetched when their first comment arrives, so it never shows "–".
  const [extraPeople, setExtraPeople] = useState<People>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const reload = useCallback(async () => {
    try {
      const list = await loadComments(quoteId);
      setComments((cur) => (JSON.stringify(cur) === JSON.stringify(list) ? cur : list));
      setError(null);
      onChangeRef.current?.(list.filter((c) => !c.parentId && !c.resolvedAt).length);
    } catch (e) {
      setError(e);
    }
  }, [quoteId]);

  useEffect(() => {
    reload();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, 20_000);
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  useEffect(() => {
    const missing = new Set<string>();
    for (const c of comments) {
      for (const id of [c.authorId, c.resolvedBy]) if (id && !people.has(id) && !extraPeople.has(id)) missing.add(id);
    }
    if (!missing.size) return;
    let alive = true;
    supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .in('id', [...missing])
      .then(({ data }) => {
        if (!alive || !data?.length) return;
        setExtraPeople((cur) => {
          const next = new Map(cur);
          for (const r of data as { id: string; full_name: string; email: string; role: string }[]) next.set(r.id, r);
          return next;
        });
      });
    return () => {
      alive = false;
    };
  }, [comments, people, extraPeople]);
  const allPeople = useMemo<People>(() => (extraPeople.size ? new Map([...people, ...extraPeople]) : people), [people, extraPeople]);

  const lineKey = lineIds.join('|');
  const sectionKey = sectionTitles.join('|');
  const value = useMemo<ReviewState>(() => {
    const threads = buildThreads(comments);
    const existing = { lineIds: new Set(lineIds), sectionTitles: new Set(sectionTitles) };
    const byKey = new Map<string, ReviewThread[]>();
    for (const t of threads) {
      const place = threadPlacement(t.root, existing);
      const key = place === 'line' ? `line:${t.root.lineId}` : place === 'section' ? `section:${t.root.sectionTitle}` : place;
      byKey.set(key, [...(byKey.get(key) ?? []), t]);
    }
    const toggle = (key: string, on?: boolean) =>
      setExpanded((cur) => {
        const next = new Set(cur);
        if (on ?? !cur.has(key)) next.add(key);
        else next.delete(key);
        return next;
      });
    return {
      threads,
      byKey,
      openCount: threads.filter((t) => t.open).length,
      resolvedCount: threads.filter((t) => !t.open).length,
      canWrite,
      expanded,
      toggle,
      focus: (key) => {
        toggle(key, true);
        window.setTimeout(() => document.getElementById(`cmt-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
      },
      post: async (target, body) => {
        setBusy(true);
        try {
          const payload =
            'parentId' in target
              ? { parent_id: target.parentId }
              : target.anchor === 'line'
                ? { anchor: 'line', line_id: target.lineId }
                : target.anchor === 'section'
                  ? { anchor: 'section', section_title: target.sectionTitle }
                  : { anchor: target.anchor };
          await callApi('quote.comment', { quote_id: quoteId, body, ...payload });
          await reload();
          return true;
        } catch (e) {
          toast((e as Error).message, 'bad');
          return false;
        } finally {
          setBusy(false);
        }
      },
      resolve: async (commentId, resolved) => {
        setBusy(true);
        try {
          await callApi('quote.comment_resolve', { comment_id: commentId, resolved });
          await reload();
        } catch (e) {
          toast((e as Error).message, 'bad');
        } finally {
          setBusy(false);
        }
      },
      people: allPeople,
      meId,
      tz,
      busy,
      error,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, lineKey, sectionKey, canWrite, expanded, allPeople, meId, tz, busy, error, quoteId, reload, toast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ----------------------------------------------------------------- pieces -----
function Composer({ placeholder, submitLabel, onSubmit, onCancel, autoFocus, label }: { placeholder: string; submitLabel: string; onSubmit: (body: string) => Promise<boolean>; onCancel?: () => void; autoFocus?: boolean; label: string }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    if (await onSubmit(body)) setText('');
    setSending(false);
  }
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label={label}
        value={text}
        autoFocus={autoFocus}
        rows={2}
        maxLength={COMMENT_MAX_LENGTH}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
        }}
        className="w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-[14.5px] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" busy={sending} disabled={!text.trim()} onClick={send}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Đóng
          </Button>
        )}
      </div>
    </div>
  );
}

function Message({ c, people, tz }: { c: ReviewComment; people: People; tz: string }) {
  const role = people.get(c.authorId)?.role as Role | undefined;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <b className="text-ink">{personName(people, c.authorId)}</b>
        {role && <span className="text-ink-3">{ROLE_LABEL[role] ?? role}</span>}
        <span className="text-ink-3">· {fmtVnDateTime(c.createdAt, tz)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-[14.5px] text-ink">{c.body}</p>
    </div>
  );
}

function Thread({ t, showPlace }: { t: ReviewThread; showPlace?: boolean }) {
  const r = useReview();
  const [replying, setReplying] = useState(false);
  return (
    <div className={cx('rounded-xl border p-3', t.open ? 'border-warn-line bg-warn-soft/50' : 'border-line bg-canvas/60')} data-thread={t.root.id} data-open={t.open}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx('inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[1px] text-[12px] font-semibold', t.open ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok-ink')}>
          <Icon name={t.open ? 'message' : 'check'} size={13} />
          {t.open ? 'Cần xử lý' : 'Đã xử lý'}
        </span>
        {showPlace && <span className="text-[12.5px] font-semibold text-ink-2">{t.root.anchorLabel}</span>}
      </div>
      <div className="mt-2 flex flex-col gap-2.5">
        <Message c={t.root} people={r.people} tz={r.tz} />
        {t.replies.map((x) => (
          <div key={x.id} className="border-l-2 border-line pl-3">
            <Message c={x} people={r.people} tz={r.tz} />
          </div>
        ))}
      </div>
      {!t.open && t.root.resolvedAt && (
        <p className="mt-2 text-[12.5px] text-ink-3">
          {personName(r.people, t.root.resolvedBy)} đánh dấu đã xử lý lúc {fmtVnDateTime(t.root.resolvedAt, r.tz)}
        </p>
      )}
      {r.canWrite && (
        <div className="mt-2.5">
          {replying ? (
            <Composer
              label={`Trả lời góp ý: ${t.root.anchorLabel}`}
              placeholder="Trả lời… (Ctrl+Enter để gửi)"
              submitLabel="Gửi trả lời"
              autoFocus
              onCancel={() => setReplying(false)}
              onSubmit={async (body) => {
                const ok = await r.post({ parentId: t.root.id }, body);
                if (ok) setReplying(false);
                return ok;
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setReplying(true)}>
                Trả lời
              </Button>
              {t.open ? (
                <Button size="sm" variant="success" icon="check" disabled={r.busy} onClick={() => r.resolve(t.root.id, true)}>
                  Đã xử lý
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={r.busy} onClick={() => r.resolve(t.root.id, false)}>
                  Mở lại
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Comment button for one place on the quote, with the number of comments still open there. */
export function CommentToggle({ target, label, className }: { target: AnchorTarget; label: string; className?: string }) {
  const r = useReview();
  const key = anchorKey(target);
  const list = r.byKey.get(key) ?? [];
  const open = list.filter((t) => t.open).length;
  if (!r.canWrite && !list.length) return null;
  const on = r.expanded.has(key);
  return (
    <button
      type="button"
      aria-label={`Góp ý: ${label}${open ? ` (${open} đang mở)` : ''}`}
      title={`Góp ý: ${label}`}
      aria-expanded={on || open > 0}
      onClick={() => r.toggle(key)}
      className={cx(
        'relative flex h-10 min-w-[40px] items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-bold',
        open ? 'bg-warn-soft text-warn' : list.length ? 'bg-ok-soft text-ok-ink' : on ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:bg-canvas hover:text-brand',
        className,
      )}
    >
      <Icon name="message" size={17} />
      {list.length > 0 && <span>{open || list.length}</span>}
    </button>
  );
}

/**
 * The comments of one place, shown right where it is on the quote: always while one is open,
 * and with handled ones plus the composer once the reader opens the place.
 */
export function AnchorThreads({ target, label, className }: { target: AnchorTarget; label: string; className?: string }) {
  const r = useReview();
  const key = anchorKey(target);
  const list = r.byKey.get(key) ?? [];
  const on = r.expanded.has(key);
  const shown = on ? list : list.filter((t) => t.open);
  if (!shown.length && !on) return null;
  const hidden = list.length - shown.length;
  return (
    <div id={`cmt-${key}`} className={cx('flex flex-col gap-2', className)}>
      {shown.map((t) => (
        <Thread key={t.root.id} t={t} />
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => r.toggle(key, true)} className="self-start text-[13px] font-semibold text-ink-3 underline">
          Xem {hidden} góp ý đã xử lý
        </button>
      )}
      {on && r.canWrite && (
        <Composer label={`Góp ý cho: ${label}`} placeholder={`Góp ý cho ${label}… (Ctrl+Enter để gửi)`} submitLabel="Gửi góp ý" autoFocus={!list.length} onCancel={() => r.toggle(key, false)} onSubmit={(body) => r.post(target, body)} />
      )}
    </div>
  );
}

/** True when a place has something to show (so a table can skip the empty row). */
export function useAnchorVisible(target: AnchorTarget): boolean {
  const r = useReview();
  const key = anchorKey(target);
  return r.expanded.has(key) || (r.byKey.get(key) ?? []).some((t) => t.open);
}

/** A table row holding the comments of one place; renders nothing while there is nothing to show. */
export function CommentTableRow({ target, label, colSpan }: { target: AnchorTarget; label: string; colSpan: number }) {
  const visible = useAnchorVisible(target);
  if (!visible) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-line-soft bg-warn-soft/30 px-3 py-3">
        <div className="mb-1.5 text-[12.5px] font-bold text-warn">Góp ý · {label}</div>
        <div className="sticky left-3 max-w-[min(640px,calc(100vw-3.5rem))]">
          <AnchorThreads target={target} label={label} />
        </div>
      </td>
    </tr>
  );
}

/** Side card: the link to send, what is still open, and comments on the quote as a whole. */
export function ReviewCard({ quoteId, code, locked }: { quoteId: string; code: string; locked: boolean }) {
  const r = useReview();
  const toast = useToast();
  const general = r.byKey.get('general') ?? [];
  const [showDone, setShowDone] = useState(false);
  const elsewhere = r.threads.filter((t) => t.open && !general.includes(t));
  return (
    <section aria-label="Góp ý trên báo giá" className="flex min-w-0 flex-col gap-3 border-t border-ink pt-3.5">
      <div>
        <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold text-ink">
          Góp ý trên báo giá
          {r.openCount > 0 && <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-[12px] font-bold text-warn">{r.openCount} cần xử lý</span>}
          {r.openCount === 0 && r.resolvedCount > 0 && <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-[12px] font-bold text-ok-ink">Đã xử lý hết</span>}
        </h2>
        <p className="mt-1 text-sm text-ink-3">
          {locked
            ? 'Báo giá đã gửi khách: góp ý được giữ lại để xem, không thêm mới.'
            : 'Gửi link này cho PM hoặc CEO. Họ mở báo giá, bấm biểu tượng góp ý ở đúng dòng cần sửa. Không cần xuất PDF hay gửi email.'}
        </p>
      </div>
      <Button
        variant="secondary"
        icon="link"
        onClick={async () => toast((await copyText(quoteLink(quoteId))) ? `Đã sao chép link ${code}. Dán vào Lark để gửi người duyệt.` : 'Không sao chép được. Hãy chép địa chỉ trên thanh trình duyệt.', 'info')}
      >
        Sao chép link báo giá
      </Button>
      {r.error != null && <p className="text-[13px] text-bad">Chưa tải được góp ý. Kiểm tra mạng rồi tải lại trang.</p>}

      {elsewhere.length > 0 && (
        <div>
          <h3 className="text-[13px] font-bold text-ink-3">Đang mở trên các dòng</h3>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {elsewhere.map((t) => {
              const place = t.root.anchor === 'line' ? `line:${t.root.lineId}` : t.root.anchor === 'section' ? `section:${t.root.sectionTitle}` : t.root.anchor;
              return (
                <li key={t.root.id}>
                  <button type="button" onClick={() => r.focus(place)} className="w-full rounded-lg border border-warn-line bg-warn-soft/50 px-3 py-2 text-left hover:bg-warn-soft">
                    <span className="block text-[13px] font-bold text-warn">{t.root.anchorLabel}</span>
                    <span className="block truncate text-[14px] text-ink">{t.root.body}</span>
                    <span className="block text-[12.5px] text-ink-3">
                      {personName(r.people, t.root.authorId)}
                      {t.replies.length > 0 && ` · ${t.replies.length} trả lời`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div id="cmt-general" className="flex flex-col gap-2">
        <h3 className="text-[13px] font-bold text-ink-3">Góp ý chung</h3>
        {general
          .filter((t) => t.open || showDone)
          .map((t) => (
            <Thread key={t.root.id} t={t} showPlace={t.root.anchor !== 'general'} />
          ))}
        {!general.some((t) => t.open) && !r.canWrite && !general.length && <p className="text-sm text-ink-3">Chưa có góp ý chung.</p>}
        {general.some((t) => !t.open) && (
          <button type="button" onClick={() => setShowDone((v) => !v)} className="self-start text-[13px] font-semibold text-ink-3 underline">
            {showDone ? 'Ẩn góp ý đã xử lý' : `Xem ${general.filter((t) => !t.open).length} góp ý đã xử lý`}
          </button>
        )}
        {r.canWrite && <Composer label="Góp ý chung cho cả báo giá" placeholder="Góp ý chung cho cả báo giá…" submitLabel="Gửi góp ý" onSubmit={(body) => r.post({ anchor: 'general' }, body)} />}
      </div>
    </section>
  );
}
