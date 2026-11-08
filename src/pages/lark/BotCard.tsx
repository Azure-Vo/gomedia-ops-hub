import type { BotMessage } from '@/domain';
import { cx } from '@/components/ui';

const HEAD: Record<BotMessage['tone'], string> = {
  red: 'bg-[#FDECEC] text-[#C62828]',
  orange: 'bg-[#FDECEC] text-[#C62828]',
  green: 'bg-[#E8F7EE] text-[#1B7F45]',
  blue: 'bg-[#E8F0FF] text-[#1F4FD1]',
  grey: 'bg-line-soft text-ink-2',
};
const BADGE: Record<BotMessage['tone'], string> = {
  red: 'border-[#F5B5B5] bg-[#FDECEC] text-[#C62828]',
  orange: 'border-[#F7CFA4] bg-[#FFF3E6] text-[#B45309]',
  green: 'border-[#A7E3BE] bg-[#E8F7EE] text-[#1B7F45]',
  blue: 'border-[#BCD0FF] bg-[#E8F0FF] text-[#1F4FD1]',
  grey: 'border-line bg-line-soft text-ink-2',
};

/** A Lark message card drawn like the CEO's sample (bot name, coloured title, task lines, @mention, badge). */
export function BotCard({ message: m, time, botName = 'GO MEDIA Task Bot', className }: { message: BotMessage; time?: string; botName?: string; className?: string }) {
  const badgeTone: BotMessage['tone'] = m.badge?.startsWith('D-') ? 'blue' : m.badge === 'D0' ? 'grey' : m.tone;
  return (
    <div className={cx('rounded-2xl border border-line bg-white p-3 shadow-sm', className)}>
      <div className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2A3A8F] text-[11px] font-black text-white" aria-hidden>
          GM
        </span>
        <b className="text-ink-2">{botName}</b>
        {time && <span>{time}</span>}
      </div>
      <div className={cx('rounded-xl px-3 py-2 text-[15.5px] font-extrabold leading-snug', HEAD[m.tone])}>{m.title}</div>
      <ul className="mt-2 flex flex-col gap-1.5 px-1 text-[14px] leading-snug text-ink">
        {m.lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>{l.icon}</span>
            <span className="min-w-0 whitespace-pre-line break-words">
              {l.label && <b>{l.label}: </b>}
              {l.mentionOpenId ? <span className="rounded bg-[#E8F0FF] px-1 font-semibold text-[#1F4FD1]">@{l.text || 'người thực hiện'}</span> : l.text}
            </span>
          </li>
        ))}
      </ul>
      {m.buttons?.length ? (
        <div className="mt-2.5 flex gap-2 px-1">
          {m.buttons.map((b) => (
            <span key={b.text} className={cx('rounded-lg border px-3 py-1.5 text-[13px] font-bold', b.type === 'primary' ? 'border-[#1F4FD1] bg-[#1F4FD1] text-white' : 'border-line text-ink-2')}>
              {b.text}
            </span>
          ))}
        </div>
      ) : null}
      {(m.note || m.badge) && (
        <div className="mt-2 flex items-end justify-between gap-2 px-1">
          <span className="text-[13px] italic text-ink-3">{m.note}</span>
          {m.badge && <span className={cx('rounded-full border px-2.5 py-0.5 text-[12px] font-extrabold', BADGE[badgeTone])}>{m.badge}</span>}
        </div>
      )}
    </div>
  );
}
