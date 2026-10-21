// Telegram webhook: account linking, check-in buttons, blocker reasons, evidence links.
import { ANSWER_LABEL, Answer, TASK_STATUS_LABEL, ROLE_LABEL } from '../../../src/domain/index';
import { applyAnswer } from './answers';
import { Ctx, Profile, profileByChat, TgState } from './context';
import { ApiError, escapeHtml as e, must, safeEqual } from './http';
import { HELP_TEXT } from './messages';

interface TgUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: { id: number }; text?: string };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number; type: string } } };
}

const REASON_WINDOW_MS = 30 * 60_000;
const EVIDENCE_WINDOW_MS = 2 * 3_600_000;
const CODE_TO_ANSWER: Record<string, Answer> = { p: 'on_plan', b: 'behind', x: 'blocked' };

async function setState(ctx: Ctx, profileId: string, state: TgState | null) {
  await ctx.db.from('profiles').update({ tg_state: state }).eq('id', profileId);
}

async function say(ctx: Ctx, chatId: number, text: string) {
  await ctx.tg?.sendMessage(chatId, text);
}

function friendly(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  console.error('telegram handler', err);
  return 'Có lỗi khi ghi nhận. Bạn thử lại, hoặc trả lời trên trang Check-in của tôi trong app.';
}

function outcomeText(answer: Answer, o: { taskName: string; doneCount: number; status: string; checkpointPct: number | null }): string {
  const head = `Đã ghi nhận: <b>${ANSWER_LABEL[answer]}</b>${o.checkpointPct ? ` · checkpoint ${o.checkpointPct}%` : ''}`;
  const body = `${e(o.taskName)} · ${o.doneCount}/4 mốc · ${TASK_STATUS_LABEL[o.status as keyof typeof TASK_STATUS_LABEL] ?? o.status}`;
  const tail =
    answer === 'behind' ? 'Đã báo E-commerce Executive để hỗ trợ.' : answer === 'blocked' ? 'Đã báo E-commerce Executive ngay.' : '';
  return [head, body, tail].filter(Boolean).join('\n');
}

async function linkAccount(ctx: Ctx, chatId: number, code: string) {
  const now = new Date(ctx.now()).toISOString();
  const p = must(
    await ctx.db.from('profiles').select('id, full_name, email, role, active').eq('telegram_link_code', code.toUpperCase()).gt('telegram_link_expires_at', now).maybeSingle(),
    'find link code',
  ) as { id: string; full_name: string; email: string; role: keyof typeof ROLE_LABEL; active: boolean } | null;
  if (!p || !p.active) {
    await say(ctx, chatId, 'Mã liên kết không đúng hoặc đã hết hạn. Vào app → Hồ sơ để lấy mã mới (hiệu lực 30 phút).');
    return;
  }
  await ctx.db.from('profiles').update({ telegram_chat_id: null, tg_state: null }).eq('telegram_chat_id', chatId).neq('id', p.id);
  await ctx.db.from('profiles').update({ telegram_chat_id: chatId, telegram_link_code: null, telegram_link_expires_at: null, tg_state: null }).eq('id', p.id);
  await ctx.db.from('events').insert({ actor: p.id, entity: 'profiles', entity_id: p.id, action: 'telegram.linked', payload: {} });
  await say(ctx, chatId, `Đã liên kết với <b>${e(p.full_name || p.email)}</b> (${ROLE_LABEL[p.role]}).\nTừ giờ bot sẽ nhắn check-in và cảnh báo tại đây, chỉ trong giờ làm việc.\n\n${HELP_TEXT}`);
}

async function listOpenTasks(ctx: Ctx, profile: Profile, chatId: number) {
  const tasks = must(
    await ctx.db.from('tasks').select('id, name, status').eq('owner_id', profile.id).is('closed_as', null).not('status', 'in', '(cancelled,done,overdue)').order('due_at').limit(10),
    'open tasks',
  ) as { id: string; name: string }[];
  if (!tasks.length) {
    await say(ctx, chatId, 'Bạn không có task nào đang mở.');
    return;
  }
  await ctx.tg?.sendMessage(chatId, 'Task nào đang bị chặn?', tasks.map((t) => [{ text: t.name.slice(0, 60), callback_data: `k:${t.id}` }]));
}

/** Checks a check-in button before asking for a blocker reason; returns a problem or null. */
async function checkpointProblem(ctx: Ctx, cpId: number, token: string, ownerId: string): Promise<string | null> {
  const cp = (await ctx.db.from('checkpoints').select('task_id, token, sent_at, answered_at, expired_at').eq('id', cpId).maybeSingle()).data as {
    task_id: string;
    token: string;
    sent_at: string | null;
    answered_at: string | null;
    expired_at: string | null;
  } | null;
  if (!cp || !safeEqual(cp.token, token)) return 'Nút này không còn hiệu lực.';
  if (cp.answered_at) return 'Checkpoint này đã được trả lời rồi.';
  if (cp.expired_at) return 'Checkpoint này đã hết hiệu lực. Hãy trả lời checkpoint mới nhất.';
  const task = (await ctx.db.from('tasks').select('owner_id').eq('id', cp.task_id).maybeSingle()).data as { owner_id: string } | null;
  if (!task || task.owner_id !== ownerId) return 'Chỉ người phụ trách task mới trả lời được.';
  return null;
}

async function onCallback(ctx: Ctx, cq: NonNullable<TgUpdate['callback_query']>) {
  const chatId = cq.message?.chat.id ?? cq.from.id;
  const data = cq.data ?? '';
  const profile = await profileByChat(ctx.db, chatId);
  if (!profile || !profile.active) {
    await ctx.tg?.answerCallback(cq.id, 'Tài khoản Telegram này chưa liên kết với app.');
    return;
  }
  if (data.startsWith('a:')) {
    const [, cpId, token, code] = data.split(':');
    const answer = CODE_TO_ANSWER[code];
    if (!answer) return;
    if (answer === 'blocked') {
      const problem = await checkpointProblem(ctx, Number(cpId), token, profile.id);
      if (problem) {
        await ctx.tg?.answerCallback(cq.id, problem);
        if (cq.message) await ctx.tg?.clearButtons(chatId, cq.message.message_id);
        return;
      }
      await setState(ctx, profile.id, { await: 'reason', task_id: '', checkpoint_id: Number(cpId), token, message_id: cq.message?.message_id, until: ctx.now() + REASON_WINDOW_MS });
      await ctx.tg?.answerCallback(cq.id, 'Nhập lý do bị chặn');
      await ctx.tg?.askForReply(chatId, 'Task đang bị chặn vì sao? Trả lời tin này bằng <b>một dòng lý do</b> (ví dụ: khách chưa gửi ảnh sản phẩm).', 'Lý do bị chặn');
      return;
    }
    try {
      const out = await applyAnswer(ctx, { actorId: profile.id, checkpointId: Number(cpId), answer, via: 'telegram', token });
      await ctx.tg?.answerCallback(cq.id, 'Đã ghi nhận');
      if (cq.message) await ctx.tg?.clearButtons(chatId, cq.message.message_id);
      await say(ctx, chatId, outcomeText(answer, out));
      if (answer === 'on_plan' && out.milestoneIdx) {
        await setState(ctx, profile.id, { await: 'evidence', task_id: out.taskId, milestone_idx: out.milestoneIdx, until: ctx.now() + EVIDENCE_WINDOW_MS });
        await say(ctx, chatId, 'Có link bằng chứng (Drive, bài đăng, file)? Gửi link vào đây trong 2 giờ tới. Không bắt buộc.');
      } else {
        await setState(ctx, profile.id, null);
      }
    } catch (err) {
      await ctx.tg?.answerCallback(cq.id, friendly(err));
      if (err instanceof ApiError && cq.message && ['already_answered', 'checkpoint_expired', 'task_closed', 'bad_token'].includes(err.code)) {
        await ctx.tg?.clearButtons(chatId, cq.message.message_id);
      }
    }
    return;
  }
  if (data.startsWith('k:')) {
    const taskId = data.slice(2);
    await setState(ctx, profile.id, { await: 'reason', task_id: taskId, checkpoint_id: null, until: ctx.now() + REASON_WINDOW_MS });
    await ctx.tg?.answerCallback(cq.id, 'Nhập lý do bị chặn');
    await ctx.tg?.askForReply(chatId, 'Task đang bị chặn vì sao? Trả lời tin này bằng <b>một dòng lý do</b>.', 'Lý do bị chặn');
    return;
  }
  await ctx.tg?.answerCallback(cq.id, 'Nút này không còn dùng được.');
}

async function onMessage(ctx: Ctx, msg: NonNullable<TgUpdate['message']>) {
  if (msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  const text = (msg.text ?? '').trim();
  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1];
    if (code) return linkAccount(ctx, chatId, code);
  }
  const profile = await profileByChat(ctx.db, chatId);
  if (!profile || !profile.active) {
    await say(ctx, chatId, 'Chào bạn! Để nhận check-in, vào app Go Media Ops Hub → <b>Hồ sơ</b> → <b>Liên kết Telegram</b>, rồi bấm link mở bot.');
    return;
  }
  if (text === '/baochan' || text.toLowerCase() === 'báo chặn') return listOpenTasks(ctx, profile, chatId);
  if (text === '/help' || text === '/start') return say(ctx, chatId, HELP_TEXT);

  const state = profile.tg_state;
  if (state && state.until > ctx.now() && text && !text.startsWith('/')) {
    if (state.await === 'reason') {
      try {
        const out = await applyAnswer(ctx, {
          actorId: profile.id,
          checkpointId: state.checkpoint_id,
          taskId: state.task_id || null,
          answer: 'blocked',
          reason: text.slice(0, 500),
          via: 'telegram',
          token: state.token ?? null,
        });
        await setState(ctx, profile.id, null);
        if (state.message_id) await ctx.tg?.clearButtons(chatId, state.message_id);
        await say(ctx, chatId, outcomeText('blocked', out));
      } catch (err) {
        await setState(ctx, profile.id, null);
        await say(ctx, chatId, friendly(err));
      }
      return;
    }
    if (state.await === 'evidence') {
      if (!/^https?:\/\/\S+$/i.test(text)) {
        await say(ctx, chatId, 'Đây chưa phải link (cần bắt đầu bằng http:// hoặc https://). Gửi lại link, hoặc bỏ qua.');
        return;
      }
      await ctx.db.from('milestones').update({ evidence_url: text.slice(0, 1000) }).eq('task_id', state.task_id).eq('idx', state.milestone_idx);
      await ctx.db.from('events').insert({ actor: profile.id, entity: 'tasks', entity_id: state.task_id, action: 'milestone.evidence_added', payload: { idx: state.milestone_idx, via: 'telegram' } });
      await setState(ctx, profile.id, null);
      await say(ctx, chatId, `Đã lưu link bằng chứng cho mốc ${state.milestone_idx}.`);
      return;
    }
  }
  await say(ctx, chatId, HELP_TEXT);
}

export async function handleTelegramUpdate(ctx: Ctx, update: TgUpdate) {
  if (!ctx.tg) return;
  if (update.callback_query) return onCallback(ctx, update.callback_query);
  if (update.message) return onMessage(ctx, update.message);
}
