import * as L from 'lucide-react';
import { ButtonHTMLAttributes, createContext, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ icons -----
// One icon set across the app: Lucide (ISC licence), 1.75px stroke, as in the Paper & ink kit.
const ICONS = {
  plus: L.Plus,
  x: L.X,
  check: L.Check,
  alert: L.TriangleAlert,
  clock: L.Clock,
  send: L.Send,
  file: L.FileText,
  fileCheck: L.FileCheck2,
  search: L.Search,
  upload: L.Upload,
  download: L.Download,
  chevronRight: L.ChevronRight,
  chevronLeft: L.ChevronLeft,
  chevronDown: L.ChevronDown,
  menu: L.Menu,
  user: L.User,
  profile: L.CircleUserRound,
  logout: L.LogOut,
  settings: L.Settings,
  chart: L.ChartColumn,
  list: L.List,
  listChecks: L.ListChecks,
  star: L.Star,
  bell: L.Bell,
  tag: L.Tags,
  archive: L.Archive,
  shield: L.ShieldCheck,
  scale: L.Scale,
  activity: L.Activity,
  link: L.Link2,
  refresh: L.RefreshCw,
  trash: L.Trash2,
  edit: L.PenLine,
  copy: L.Copy,
  play: L.Play,
  tasks: L.SquareCheckBig,
  message: L.MessageSquare,
  calendar: L.CalendarDays,
  inbox: L.Inbox,
  users: L.Users,
  sun: L.Sun,
  folder: L.Folder,
  info: L.Info,
  telegram: L.Send,
  signature: L.Signature,
  eye: L.Eye,
  ask: L.MessageCircleQuestion,
  medal: L.Medal,
} satisfies Record<string, L.LucideIcon>;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className, strokeWidth = 1.75 }: { name: IconName | string; size?: number; className?: string; strokeWidth?: number }) {
  const Svg = ICONS[name as IconName] ?? L.CircleAlert;
  return <Svg size={size} strokeWidth={strokeWidth} absoluteStrokeWidth={false} aria-hidden="true" className={className} />;
}

// ---------------------------------------------------------------- buttons -----
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'accent';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark active:translate-y-px disabled:bg-brand/45',
  secondary: 'bg-paper text-ink border border-line-edge hover:border-line-control hover:bg-[#F7F7F5] active:translate-y-px disabled:opacity-50',
  ghost: 'bg-transparent text-ink-2 hover:bg-ink/[0.06] hover:text-ink disabled:opacity-50',
  danger: 'bg-paper text-bad border border-bad-line hover:bg-bad-soft disabled:opacity-50',
  success: 'bg-ink text-white hover:bg-[#33332F] active:translate-y-px disabled:opacity-50',
  accent: 'bg-transparent text-brand border border-dashed border-brand-line hover:bg-brand-soft hover:border-brand disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: string; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-out disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'min-h-[32px] px-3.5 text-[13px]' : size === 'lg' ? 'min-h-[46px] px-6 text-[15px]' : 'min-h-[38px] px-4 text-[14px]',
        VARIANTS[variant],
        className,
      )}
    >
      {busy ? <Spinner size={16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={cx('inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-ink/[0.06] hover:text-ink disabled:opacity-40', className)}>
      <Icon name={icon} size={17} />
    </button>
  );
}

// ----------------------------------------------------------------- inputs -----
const fieldCore = 'rounded-xl border border-line-control bg-paper px-3 text-[14.5px] text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 hover:border-ink-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:border-line disabled:bg-canvas disabled:text-ink-2';
/** Full width unless the caller sets its own width (Tailwind would otherwise let w-full win). */
const fieldBase = (className?: string) => cx(/(^|\s)w-/.test(className ?? '') ? '' : 'w-full', fieldCore);

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(fieldBase(className), 'min-h-[40px]', className)} />;
}

/**
 * A number box that types like a text box: no "010" when you type over a 0, comma or dot as decimal mark,
 * everything selected on focus, ↑/↓ step by `step`. The value is clamped to [min, max] as you type.
 */
export function NumberField({
  value,
  onValue,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  decimals = 1,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'step' | 'type'> & { value: number; onValue: (v: number) => void; min?: number; max?: number; step?: number; decimals?: number }) {
  const show = (v: number) => String(Math.round(v * 10 ** decimals) / 10 ** decimals).replace('.', ',');
  const [draft, setDraft] = useState(show(value));
  const parse = (t: string) => Number(t.replace(',', '.'));
  useEffect(() => {
    // Follow outside changes, but leave a half-typed "1," alone.
    if (parse(draft) !== value) setDraft(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = (t: string) => {
    let clean = t.replace(/[^\d.,]/g, '').replace(/[.,](?=.*[.,])/g, '');
    clean = clean.replace(/^0+(?=\d)/, '');
    if (decimals === 0) clean = clean.replace(/[.,].*$/, '');
    setDraft(clean);
    const n = parse(clean);
    if (clean !== '' && Number.isFinite(n)) onValue(clamp(n));
    else if (clean === '') onValue(clamp(0));
  };
  return (
    <input
      {...rest}
      type="text"
      inputMode={decimals ? 'decimal' : 'numeric'}
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => setDraft(show(value))}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const v = clamp(Math.round(((Number.isFinite(parse(draft)) ? parse(draft) : value) + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000);
        setDraft(show(v));
        onValue(v);
      }}
      className={className}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(fieldBase(className), 'min-h-[88px] py-2', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(fieldBase(className), 'min-h-[40px] pr-8', className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-[13px] text-bad">{error}</p> : hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ layout -----
/**
 * Progressive disclosure: a small (i) next to a title. The screen keeps one short line; the rules,
 * thresholds and "why" live here and open on click (or focus + Enter). Closes on Escape or outside click.
 */
export function InfoTip({ children, label = 'Giải thích', align = 'left' }: { children: ReactNode; label?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className={cx('grid h-6 w-6 place-items-center rounded-full text-ink-3 hover:bg-ink/5 hover:text-ink', open && 'bg-ink/5 text-ink')}>
        <Icon name="info" size={16} />
      </button>
      {open && (
        <span id={id} role="note" className={cx('absolute top-7 z-40 w-[min(340px,80vw)] rounded-xl border border-line-edge bg-paper p-3 text-left text-[13.5px] font-normal leading-relaxed tracking-normal text-ink-2 shadow-lift', align === 'right' ? 'right-0' : 'left-0')}>
          {children}
        </span>
      )}
    </span>
  );
}

export function Card({ children, className, title, actions, subtitle, info }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; info?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-paper p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-1 text-[17px] font-semibold text-ink">
                {title}
                {info && <InfoTip label={`Giải thích: ${typeof title === 'string' ? title : ''}`}>{info}</InfoTip>}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 max-w-[75ch] text-[13.5px] text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, info }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; info?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-1.5 text-[32px] font-semibold leading-[38px] tracking-[-0.01em] text-ink">
          {title}
          {info && <InfoTip label={`Giải thích: ${typeof title === 'string' ? title : 'trang này'}`}>{info}</InfoTip>}
        </h1>
        {subtitle && <p className="mt-1 max-w-[75ch] text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'accent' | 'solidOk' | 'solidBad';
const TONES: Record<Tone, string> = {
  neutral: 'bg-line-soft text-ink-2',
  brand: 'bg-brand-soft text-brand',
  ok: 'bg-ok-soft text-ok-ink',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  accent: 'bg-accent-soft text-accent',
  solidOk: 'bg-ink text-white',
  solidBad: 'bg-bad text-white',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] font-sans px-2 py-[1px] text-[12px] font-medium leading-5', TONES[tone], className)}>{children}</span>;
}

const BANNER: Record<'ok' | 'warn' | 'bad' | 'info', [string, string]> = {
  ok: ['bg-ok-soft text-ok-ink', 'check'],
  warn: ['bg-warn-soft text-warn', 'alert'],
  bad: ['bg-bad-soft text-bad', 'alert'],
  info: ['bg-brand-soft text-ink', 'info'],
};

export function Banner({ tone = 'info', title, children, actions, className }: { tone?: 'ok' | 'warn' | 'bad' | 'info'; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  const [cls, icon] = BANNER[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3', cls, className)}>
      <div className="flex min-w-0 flex-1 basis-72 items-start gap-2.5">
        <Icon name={icon} size={18} className="mt-[3px] shrink-0" />
        <div className="min-w-0">
          {title && <div className="font-semibold">{title}</div>}
          {children && <div className="text-[14px]">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-ink-3">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line-control/60 bg-paper/60 px-6 py-10 text-center">
      <div className="font-semibold text-ink">{title}</div>
      {children && <div className="max-w-md text-sm text-ink-3">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <Banner tone="bad" title="Có lỗi">{error instanceof Error ? error.message : String(error)}</Banner>;
}

// ------------------------------------------------------------------- modal -----
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Callers often pass an inline onClose; keep it in a ref so typing (a re-render) never re-runs the focus effect.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Focus the first field in the body, never the header close button.
    const first =
      bodyRef.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])') ??
      ref.current?.querySelector<HTMLElement>('[data-modal-footer] button:not([disabled])') ??
      ref.current;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} className={cx('w-full outline-none rounded-2xl bg-paper shadow-lift', wide === 'xl' ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5">
          <h2 className="text-[18px] font-semibold text-ink">{title}</h2>
          <IconButton icon="x" label="Đóng" onClick={onClose} />
        </div>
        <div ref={bodyRef} className={cx('overflow-y-auto px-6 py-3', wide === 'xl' ? 'max-h-[76vh]' : 'max-h-[70vh]')}>{children}</div>
        {footer && <div data-modal-footer className="flex flex-wrap justify-end gap-2 px-6 pb-5 pt-3">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- toast -----
interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'bad' | 'info';
}
const ToastCtx = createContext<(text: string, tone?: ToastItem['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastItem['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'bad' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role="status" className={cx('pointer-events-auto rounded-xl px-4 py-3 text-sm font-medium shadow-lift', t.tone === 'bad' ? 'bg-bad text-white' : t.tone === 'info' ? 'bg-brand text-white' : 'bg-ink text-white')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// ------------------------------------------------------------- data hooks -----
/** Small async-state helper for page loads. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: null, error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'bad' | null }) {
  return (
    <div className="rounded-2xl border border-line bg-paper px-4 py-3.5">
      <div className="text-[13px] font-medium text-ink-2">{label}</div>
      <div className={cx('mt-0.5 text-[30px] font-semibold leading-tight tracking-[-0.02em]', tone === 'ok' ? 'text-ok-ink' : tone === 'bad' ? 'text-bad' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-1 text-[13px] text-ink-3">{sub}</div>}
    </div>
  );
}
