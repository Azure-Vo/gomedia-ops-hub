import type { ReactNode } from 'react';
import * as L from 'lucide-react';
import type { BotMessage } from '@/domain';
import { cx } from '@/components/ui';

const HEAD: Record<BotMessage['tone'], string> = {
  red: 'bg-bad-soft text-bad',
  orange: 'bg-bad-soft text-bad',
  green: 'bg-ok-soft text-ok-ink',
  blue: 'bg-info-soft text-info',
  grey: 'bg-line-soft text-ink-2',
};
const BADGE: Record<BotMessage['tone'], string> = {
  red: 'border-bad-line bg-bad-soft text-bad',
  orange: 'border-accent-line bg-accent-soft text-accent-strong',
  green: 'border-ok-line bg-ok-soft text-ok-ink',
  blue: 'border-brand-line bg-info-soft text-info',
  grey: 'border-line bg-line-soft text-ink-2',
};

/**
 * The bot's messages carry emoji because Lark cards can only show text. On the web the same message is
 * drawn with Lucide icons instead (DESIGN.md: one icon set, no emoji as icons). Unknown emoji are dropped.
 */
type Glyph = { icon: L.LucideIcon; className?: string; fill?: boolean };
const GOLD = 'text-[#C9971C]';
const GLYPHS: Record<string, Glyph> = {
  '🏆': { icon: L.Trophy, className: GOLD },
  '🥇': { icon: L.Medal, className: GOLD },
  '🥈': { icon: L.Medal, className: 'text-[#8A8F98]' },
  '🥉': { icon: L.Medal, className: 'text-[#A8693A]' },
  '⭐': { icon: L.Star, className: 'text-[#E39A12]', fill: true },
  '🌟': { icon: L.Sparkles },
  '🎉': { icon: L.PartyPopper },
  '📌': { icon: L.Pin },
  '📍': { icon: L.MapPin },
  '🔸': { icon: L.CornerDownRight },
  '👤': { icon: L.User },
  '🧑‍💼': { icon: L.UserRound },
  '💼': { icon: L.Briefcase },
  '🏢': { icon: L.Building2 },
  '⏰': { icon: L.AlarmClock },
  '🕒': { icon: L.Clock },
  '⏳': { icon: L.Hourglass },
  '📅': { icon: L.CalendarDays },
  '⚠️': { icon: L.TriangleAlert },
  '❗': { icon: L.CircleAlert },
  '⛔': { icon: L.OctagonX },
  '🚫': { icon: L.Ban },
  '❌': { icon: L.CircleX },
  '✅': { icon: L.CircleCheck },
  '🏁': { icon: L.Flag },
  '🔗': { icon: L.Link2 },
  '📎': { icon: L.Paperclip },
  'ℹ️': { icon: L.Info },
  '🗑️': { icon: L.Trash2 },
  '📥': { icon: L.Inbox },
  '📨': { icon: L.Send },
  '💬': { icon: L.MessageSquare },
  '📝': { icon: L.NotebookPen },
  '✏️': { icon: L.PenLine },
  '🎯': { icon: L.Target },
  '🤖': { icon: L.Bot },
  '☀️': { icon: L.Sun },
  '🌙': { icon: L.Moon },
  '↩️': { icon: L.Undo2 },
  '🔴': { icon: L.Circle, className: 'text-bad', fill: true },
  '🟡': { icon: L.Circle, className: 'text-[#D08A1A]', fill: true },
  '🟢': { icon: L.Circle, className: 'text-ok', fill: true },
};

const EMOJI = /(\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*️?|[ℹ↩]️?)/u;
const EMOJI_G = new RegExp(EMOJI.source, 'gu');

function GlyphIcon({ e, size }: { e: string; size: number }) {
  const g = GLYPHS[e] ?? GLYPHS[e.replace(/️/g, '')] ?? GLYPHS[`${e.replace(/️/g, '')}️`];
  if (!g) return null;
  const Icon = g.icon;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" className={cx('inline-block shrink-0', g.fill && 'fill-current', g.className)} />;
}

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Text with Lark markdown links drawn as links and any emoji swapped for an inline Lucide icon. */
function Rich({ text, size = 15 }: { text: string; size?: number }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    out.push(<Plain key={`t${last}`} text={text.slice(last, m.index)} size={size} />);
    out.push(
      <a key={`l${m.index}`} href={m[2]} target="_blank" rel="noopener" className="font-semibold text-brand underline-offset-2 hover:underline">
        {m[1]}
      </a>,
    );
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(<Plain key={`t${last}`} text={text.slice(last)} size={size} />);
  return out;
}

function Plain({ text, size }: { text: string; size: number }): ReactNode {
  const parts = text.split(EMOJI_G);
  return parts.map((p, i) =>
    i % 2 ? (
      <span key={i} className="inline-flex align-[-2px]">
        <GlyphIcon e={p} size={size} />
      </span>
    ) : (
      p.replace(/ · /g, ', ').replace(/\s{2,}/g, ' ')
    ),
  );
}

/** "🌟 Go Star …" → icon + "Go Star …" */
function splitLead(text: string): [string | null, string] {
  const m = text.match(new RegExp(`^${EMOJI.source}\\s*`, 'u'));
  return m ? [m[1], text.slice(m[0].length)] : [null, text];
}

/** A Lark message card drawn like the CEO's sample (bot name, coloured title, task lines, @mention, badge). */
export function BotCard({ message: m, time, botName = 'GO MEDIA Task Bot', className }: { message: BotMessage; time?: string; botName?: string; className?: string }) {
  const badgeTone: BotMessage['tone'] = m.badge?.startsWith('D-') ? 'blue' : m.badge === 'D0' ? 'grey' : m.tone;
  const [titleGlyph, title] = splitLead(m.title);
  return (
    <div className={cx('rounded-2xl border border-line bg-paper p-3', className)}>
      <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[10.5px] font-semibold text-white" aria-hidden>
          GM
        </span>
        <b className="text-ink-2">{botName}</b>
        {time && <span>{time}</span>}
      </div>
      <div className={cx('flex items-center gap-2 rounded-xl px-3 py-2 text-[15.5px] font-semibold leading-snug', HEAD[m.tone])}>
        {titleGlyph && <GlyphIcon e={titleGlyph} size={18} />}
        <span className="min-w-0">
          <Rich text={title} />
        </span>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5 px-1 text-[14px] leading-snug text-ink">
        {m.lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[2px] flex w-4 justify-center text-ink-3" aria-hidden>
              <GlyphIcon e={l.icon} size={16} />
            </span>
            <span className="min-w-0 whitespace-pre-line break-words">
              {l.label && <b>{l.label}: </b>}
              {l.mentionOpenId ? <span className="rounded bg-info-soft px-1 font-semibold text-info">@{l.text || 'người thực hiện'}</span> : <Rich text={l.text} size={14} />}
            </span>
          </li>
        ))}
      </ul>
      {m.buttons?.length ? (
        <div className="mt-2.5 flex gap-2 px-1">
          {m.buttons.map((b) => (
            <span key={b.text} className={cx('rounded-full border px-3 py-1.5 text-[13px] font-semibold', b.type === 'primary' ? 'border-brand bg-brand text-white' : 'border-line-edge text-ink-2')}>
              <Rich text={b.text} size={13} />
            </span>
          ))}
        </div>
      ) : null}
      {(m.note || m.badge) && (
        <div className="mt-2 flex items-end justify-between gap-2 px-1">
          <span className="text-[13px] italic text-ink-3">{m.note && <Rich text={m.note} size={13} />}</span>
          {m.badge && <span className={cx('rounded-full border px-2.5 py-0.5 text-[12px] font-semibold', BADGE[badgeTone])}>{m.badge}</span>}
        </div>
      )}
    </div>
  );
}
