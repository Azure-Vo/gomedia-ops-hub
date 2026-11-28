// 1.8 · Tin bot báo giá gửi vào nhóm Lark (qua webhook Custom Bot hoặc mô phỏng trên web).
// Mỗi mốc của hành trình báo giá có một tin, để Account, PM và CEO không phải mở app để biết đến lượt ai.
import type { BotMessage } from './lark';
import { fmtVnd, fmtNum } from './labels';

export type QuoteBotKind =
  | 'submitted'
  | 'commented'
  | 'changes'
  | 'approved'
  | 'signed'
  | 'sent'
  | 'client_viewed'
  | 'client_signed'
  | 'client_changes';

export interface QuoteBotInput {
  code: string;
  client: string;
  accountName: string;
  total?: number | null;
  /** Vòng duyệt hiện tại (1 = lần đầu). */
  round?: number;
  actorName?: string;
  /** Người duyệt đang chờ (PM / CEO). */
  waitingFor?: string;
  place?: string;
  body?: string;
  openComments?: number;
  /** Giờ làm việc từ lúc nhận yêu cầu đến mốc này. */
  hoursSoFar?: number | null;
  targetHours?: number;
  rounds?: number;
  accountSigned?: boolean;
}

const short = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);
const quoteLine = (i: QuoteBotInput) => ({ icon: '📄', label: 'Báo giá', text: `${i.code} · ${i.client}` });
const hoursLine = (i: QuoteBotInput) =>
  i.hoursSoFar === null || i.hoursSoFar === undefined
    ? null
    : { icon: '⏱️', label: 'Đã mất', text: `${fmtNum(i.hoursSoFar, 1)} giờ làm việc (mục tiêu ≤ ${i.targetHours ?? 8} giờ)` };

export function quoteBotMessage(kind: QuoteBotKind, i: QuoteBotInput): BotMessage {
  const lines: BotMessage['lines'] = [quoteLine(i)];
  const h = hoursLine(i);
  switch (kind) {
    case 'submitted': {
      const again = (i.round ?? 1) > 1;
      lines.push({ icon: '✍️', label: 'Account', text: `${i.accountName}${i.accountSigned ? ' (đã ký người lập)' : ''}` });
      if (i.total) lines.push({ icon: '💰', label: 'Tổng', text: fmtVnd(i.total) });
      lines.push({ icon: '👀', label: 'Chờ', text: `${i.waitingFor ?? 'PM/CEO'} mở link, góp ý trên từng dòng rồi duyệt` });
      if (h) lines.push(h);
      return {
        tone: 'orange',
        title: again ? `🟠 Báo giá đã sửa xong – gửi duyệt lại (vòng ${i.round})` : '🟠 Báo giá mới chờ duyệt',
        lines,
        badge: `Vòng ${i.round ?? 1}`,
      };
    }
    case 'commented':
      lines.push({ icon: '💬', label: i.actorName ?? 'Góp ý', text: `${i.place ? `[${i.place}] ` : ''}${short(i.body ?? '')}` });
      return { tone: 'blue', title: '💬 Góp ý mới trên báo giá', lines, note: `@${i.accountName} xem và sửa trên link báo giá.` };
    case 'changes':
      lines.push({ icon: '🙋', label: 'Người yêu cầu', text: i.actorName ?? '' });
      if (i.openComments) lines.push({ icon: '📝', label: 'Góp ý cần xử lý', text: String(i.openComments) });
      if (i.body) lines.push({ icon: '💬', label: 'Ghi chú', text: short(i.body) });
      lines.push({ icon: '👤', label: 'Account sửa', text: i.accountName });
      if (h) lines.push(h);
      return { tone: 'red', title: `🔴 Yêu cầu sửa báo giá – vòng ${i.round ?? 1}`, lines, badge: `Vòng sửa ${i.round ?? 1}` };
    case 'approved':
      lines.push({ icon: '✅', label: 'Đã duyệt', text: i.actorName ?? 'PM' });
      lines.push({ icon: '✍️', label: 'Chờ', text: 'CEO xem trước PDF và ký' });
      if (h) lines.push(h);
      return { tone: 'green', title: '🟢 Báo giá đã duyệt – chờ CEO ký', lines };
    case 'signed':
      lines.push({ icon: '✍️', label: 'CEO đã ký', text: i.actorName ?? 'CEO' });
      lines.push({ icon: '📤', label: 'Tiếp theo', text: `${i.accountName} xuất PDF và gửi khách` });
      if (h) lines.push(h);
      return { tone: 'green', title: '🟢 CEO đã ký báo giá', lines };
    case 'sent': {
      const ok = i.hoursSoFar !== null && i.hoursSoFar !== undefined && i.hoursSoFar <= (i.targetHours ?? 8) + 1e-9;
      lines.push({ icon: '👤', label: 'Account', text: i.accountName });
      if (h) lines.push({ ...h, label: 'Tổng thời gian' });
      lines.push({ icon: '🔁', label: 'Số vòng sửa', text: String(i.rounds ?? 0) });
      return { tone: ok ? 'green' : 'orange', title: ok ? '📤 Đã gửi khách – đạt mục tiêu' : '📤 Đã gửi khách – quá mục tiêu', lines, note: 'Khách xem và ký qua link công khai.' };
    }
    case 'client_viewed':
      lines.push({ icon: '👁️', label: 'Khách', text: 'đã mở link báo giá' });
      return { tone: 'grey', title: '👁️ Khách đã mở báo giá', lines };
    case 'client_signed':
      lines.push({ icon: '✍️', label: 'Khách ký', text: i.actorName ?? i.client });
      lines.push({ icon: '👤', label: 'Account', text: i.accountName });
      return { tone: 'green', title: '🎉 Khách đã ký xác nhận báo giá', lines, note: 'Báo giá đã đủ 3 chữ ký: Account, CEO, khách hàng.' };
    case 'client_changes':
      lines.push({ icon: '🙋', label: 'Khách', text: i.actorName ?? i.client });
      if (i.body) lines.push({ icon: '💬', label: 'Đề nghị', text: short(i.body) });
      lines.push({ icon: '👤', label: 'Account xử lý', text: i.accountName });
      return { tone: 'red', title: '🔴 Khách đề nghị điều chỉnh báo giá', lines };
  }
}

/** Card cho webhook Custom Bot: chỉ có nút mở link (Custom Bot không nhận bấm nút). */
export function toWebhookCard(m: BotMessage, url: string | null, buttonText = 'Mở báo giá'): Record<string, unknown> {
  const template = m.tone;
  const body = m.lines.map((l) => `${l.icon} ${l.label ? `**${l.label}:** ` : ''}${l.text}`).join('\n');
  const elements: Record<string, unknown>[] = [{ tag: 'div', text: { tag: 'lark_md', content: body } }];
  if (url) elements.push({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: buttonText }, type: 'primary', url }] });
  if (m.note || m.badge) elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: [m.note, m.badge ? `[${m.badge}]` : ''].filter(Boolean).join('  ') }] });
  return { config: { wide_screen_mode: true }, header: { template, title: { tag: 'plain_text', content: m.title } }, elements };
}

/** Định dạng URL webhook Custom Bot của Lark / Feishu. */
export const WEBHOOK_URL_RE = /^https:\/\/open\.(larksuite\.com|feishu\.cn)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]+$/;
