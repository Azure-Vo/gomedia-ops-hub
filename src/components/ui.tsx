import { ButtonHTMLAttributes, createContext, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ icons -----
const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.2 4.2L19 7',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  file: 'M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9l-6-6zM14 3v6h6',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  user: 'M20 21a8 8 0 10-16 0M12 13a5 5 0 100-10 5 5 0 000 10z',
  logout: 'M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l-5-5 5-5M5 12h11',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  link: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7',
  refresh: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  play: 'M6 4l14 8-14 8V4z',
  tasks: 'M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9',
  telegram: 'M21.5 4.5L2.8 11.7c-1 .4-1 1.6 0 1.9l4.6 1.5 1.8 5.6c.2.7 1.1.9 1.6.4l2.6-2.4 4.8 3.5c.6.4 1.4.1 1.6-.6l3.4-15.6c.2-.9-.7-1.7-1.7-1.5zM9.4 14.7l8.4-7.4',
};

export function Icon({ name, size = 18, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name] ?? PATHS.alert} />
    </svg>
  );
}

// ---------------------------------------------------------------- buttons -----
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'accent';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50',
  secondary: 'bg-white text-brand border-[1.5px] border-brand hover:bg-brand-soft disabled:opacity-50',
  ghost: 'bg-transparent text-ink-2 hover:bg-canvas disabled:opacity-50',
  danger: 'bg-white text-bad border-[1.5px] border-bad-line hover:bg-bad-soft disabled:opacity-50',
  success: 'bg-ok text-white hover:bg-ok-ink disabled:opacity-50',
  accent: 'bg-accent-soft text-accent border-[1.5px] border-dashed border-accent-line hover:bg-[#FFE9D6] disabled:opacity-50',
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
        'inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold transition-colors disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'min-h-[40px] px-3 text-sm' : size === 'lg' ? 'min-h-[52px] px-6 text-base' : 'min-h-[44px] px-4 text-[15px]',
        VARIANTS[variant],
        className,
      )}
    >
      {busy ? <Spinner size={16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={cx('inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-ink-3 hover:bg-canvas hover:text-ink disabled:opacity-40', className)}>
      <Icon name={icon} />
    </button>
  );
}

// ----------------------------------------------------------------- inputs -----
const fieldCore = 'rounded-lg border-[1.5px] border-line bg-white px-3 text-[15px] text-ink placeholder:text-ink-3/70 focus:border-brand focus:outline-none disabled:bg-canvas disabled:text-ink-3';
/** Full width unless the caller sets its own width (Tailwind would otherwise let w-full win). */
const fieldBase = (className?: string) => cx(/(^|\s)w-/.test(className ?? '') ? '' : 'w-full', fieldCore);

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(fieldBase(className), 'min-h-[44px]', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(fieldBase(className), 'min-h-[88px] py-2', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(fieldBase(className), 'min-h-[44px] pr-8', className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-[13px] text-bad">{error}</p> : hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ layout -----
export function Card({ children, className, title, actions, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-white p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-bold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-extrabold leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-ink-3">{subtitle}</p>}
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
  solidOk: 'bg-ok text-white',
  solidBad: 'bg-bad text-white',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-bold tracking-wide', TONES[tone], className)}>{children}</span>;
}

const BANNER: Record<'ok' | 'warn' | 'bad' | 'info', [string, string]> = {
  ok: ['border-ok-line bg-ok-soft text-ok-ink', 'check'],
  warn: ['border-accent-line bg-accent-soft text-[#9A3412]', 'alert'],
  bad: ['border-bad-line bg-bad-soft text-bad', 'alert'],
  info: ['border-brand-line bg-brand-soft text-brand', 'alert'],
};

export function Banner({ tone = 'info', title, children, actions, className }: { tone?: 'ok' | 'warn' | 'bad' | 'info'; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  const [cls, icon] = BANNER[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 rounded-[14px] border-[1.5px] px-4 py-3', cls, className)}>
      <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
        <Icon name={icon} size={22} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          {title && <div className="font-bold">{title}</div>}
          {children && <div className="text-[14px] opacity-90">{children}</div>}
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
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <div className="font-semibold text-ink-2">{title}</div>
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
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('w-full rounded-2xl bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <IconButton icon="x" label="Đóng" onClick={onClose} />
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft px-5 py-3">{footer}</div>}
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
          <div key={t.id} role="status" className={cx('pointer-events-auto rounded-xl px-4 py-3 text-sm font-semibold shadow-lg', t.tone === 'bad' ? 'bg-bad text-white' : t.tone === 'info' ? 'bg-brand text-white' : 'bg-ink text-white')}>
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
    <div className="rounded-xl bg-canvas p-4">
      <div className="text-[13px] font-semibold text-ink-2">{label}</div>
      <div className={cx('mt-1 text-[28px] font-extrabold leading-tight', tone === 'ok' ? 'text-ok-ink' : tone === 'bad' ? 'text-bad' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-1 text-[13px] text-ink-3">{sub}</div>}
    </div>
  );
}
