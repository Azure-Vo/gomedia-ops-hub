// Vietnamese bot messages (Telegram HTML).
import { ALERT_LABEL, AlertKind, BAND_LABEL, BandLevel, fmtVnd, fmtVnShort, PublicBandReason, ROLE_LABEL, Role, describeReason } from '../../../src/domain/index';
import { escapeHtml as e } from './http';
import type { Button } from './notify';

export interface MilestoneInfo {
  idx: number;
  label: string;
  done_at: string | null;
}

export function checkpointText(o: { taskName: string; pct: number; idx: number; milestone: string; dueAt: string; tz: string }): string {
  return [
    `<b>Checkpoint ${o.pct}%</b> · ${e(o.taskName)}`,
    `Deadline: ${fmtVnShort(o.dueAt, o.tz)}`,
    '',
    'Theo kế hoạch, đến lúc này cần xong:',
    `<b>Mốc ${o.idx}/4: ${e(o.milestone)}</b>`,
    '',
    'Mốc này đã xong chưa? Chọn đúng tình trạng thật.',
  ].join('\n');
}

export function checkpointButtons(cpId: number, token: string): Button[][] {
  return [
    [{ text: 'Đúng kế hoạch (đã xong)', data: `a:${cpId}:${token}:p` }],
    [
      { text: 'Chậm hơn kế hoạch', data: `a:${cpId}:${token}:b` },
      { text: 'Bị chặn', data: `a:${cpId}:${token}:x` },
    ],
  ];
}

export function alertText(o: {
  kind: AlertKind;
  taskName: string;
  ownerName: string;
  milestones: MilestoneInfo[];
  plannedIdx: number | null;
  priorityNote: string | null;
  reason: string | null;
  dueAt: string;
  tz: string;
}): string {
  const done = o.milestones.filter((m) => m.done_at).map((m) => m.label);
  const upto = Math.max(o.plannedIdx ?? 0, done.length + 1);
  const pending = o.milestones.filter((m) => !m.done_at && m.idx <= upto).map((m) => m.label);
  const lines = [
    `<b>CẢNH BÁO · ${ALERT_LABEL[o.kind].toUpperCase()}</b>`,
    `${e(o.taskName)} · ${e(o.ownerName)}`,
    `Deadline: ${fmtVnShort(o.dueAt, o.tz)}`,
    `Đã xong: ${done.length ? e(done.join(', ')) : 'chưa có mốc nào'}`,
  ];
  if (o.kind !== 'overdue') lines.push(`Đang chờ: ${pending.length ? e(pending.join(', ')) : '–'}`);
  if (o.reason) lines.push(`${o.kind === 'blocker' ? 'Lý do' : 'Ghi chú'}: ${e(o.reason)}`);
  if (o.priorityNote && o.kind !== 'overdue') lines.push(`Ưu tiên: ${e(o.priorityNote)}`);
  return lines.join('\n');
}

export function approvalRequestText(o: { code: string; client: string; total: number; level: BandLevel; accountName: string; reasons: PublicBandReason[] }): string {
  return [
    `<b>Báo giá chờ bạn duyệt · ${e(o.code)}</b>`,
    `Khách: ${e(o.client)} · Tổng: ${fmtVnd(o.total)}`,
    `Người lập: ${e(o.accountName)} · ${BAND_LABEL[o.level]}`,
    ...o.reasons.map((r) => `• ${e(describeReason(r))}`),
  ].join('\n');
}

export function decisionText(o: { code: string; decision: 'approve' | 'changes'; approverRole: Role; comment: string | null }): string {
  const head = o.decision === 'approve' ? `<b>${e(o.code)} đã được duyệt</b> · có thể xuất PDF và gửi khách` : `<b>${e(o.code)} cần sửa</b>`;
  return [head, `Người duyệt: ${ROLE_LABEL[o.approverRole]}`, o.comment ? `Nhận xét: ${e(o.comment)}` : ''].filter(Boolean).join('\n');
}

export function linkButton(text: string, url: string | null): Button[][] | undefined {
  return url ? [[{ text, url }]] : undefined;
}

export const HELP_TEXT = [
  '<b>Go Media Task Bot</b>',
  'Bot hỏi tiến độ mỗi task ở 25%, 50%, 75% và 99% thời gian làm việc, chỉ trong giờ làm.',
  '',
  '/baochan · báo một task đang bị chặn ngay bây giờ',
  '/help · xem hướng dẫn này',
  '',
  'Chưa liên kết tài khoản? Vào app → Hồ sơ → Liên kết Telegram.',
].join('\n');
