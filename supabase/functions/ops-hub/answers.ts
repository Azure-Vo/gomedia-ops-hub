// One path for every check-in answer, whether it comes from the web page or Telegram.
import { Answer, answerEffect, checkpointIndex, TaskStatus } from '../../../src/domain/index';
import { notifyAlert } from './alerts';
import type { Ctx } from './context';
import { ApiError, must, safeEqual } from './http';

export interface AnswerRequest {
  actorId: string;
  taskId?: string | null;
  checkpointId?: number | null;
  answer: Answer;
  reason?: string | null;
  evidenceUrl?: string | null;
  via: 'web' | 'telegram';
  token?: string | null;
}

export interface AnswerOutcome {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  doneCount: number;
  alertId: string | null;
  checkpointPct: number | null;
  milestoneIdx: number | null;
}

interface CpRow {
  id: number;
  task_id: string;
  pct: number;
  sent_at: string | null;
  answered_at: string | null;
  expired_at: string | null;
  token: string;
}

function cleanUrl(u: string | null | undefined): string | null {
  const s = (u ?? '').trim();
  if (!s) return null;
  if (!/^https?:\/\/\S+$/i.test(s)) throw new ApiError(400, 'bad_url', 'Link bằng chứng phải bắt đầu bằng http:// hoặc https://');
  return s.slice(0, 1000);
}

export async function applyAnswer(ctx: Ctx, req: AnswerRequest): Promise<AnswerOutcome> {
  const evidence = cleanUrl(req.evidenceUrl);
  for (let attempt = 0; attempt < 3; attempt++) {
    let cp: CpRow | null = null;
    if (req.checkpointId) {
      cp = must(
        await ctx.db.from('checkpoints').select('id, task_id, pct, sent_at, answered_at, expired_at, token').eq('id', req.checkpointId).maybeSingle(),
        'load checkpoint',
      ) as CpRow | null;
      if (!cp) throw new ApiError(404, 'checkpoint_not_found', 'Không tìm thấy checkpoint.');
      if (req.via === 'telegram' && !safeEqual(cp.token, req.token ?? '')) throw new ApiError(403, 'bad_token', 'Nút này không còn hiệu lực.');
      if (cp.answered_at) throw new ApiError(409, 'already_answered', 'Checkpoint này đã được trả lời rồi.');
      if (cp.expired_at) throw new ApiError(409, 'checkpoint_expired', 'Checkpoint này đã hết hiệu lực. Hãy trả lời checkpoint mới nhất.');
      if (!cp.sent_at) throw new ApiError(409, 'checkpoint_not_sent', 'Checkpoint này chưa đến giờ.');
    }
    const taskId = cp?.task_id ?? req.taskId;
    if (!taskId) throw new ApiError(400, 'task_required', 'Thiếu task.');
    const task = must(
      await ctx.db.from('tasks').select('id, name, owner_id, status, due_at, closed_as').eq('id', taskId).maybeSingle(),
      'load task',
    ) as { id: string; name: string; owner_id: string; status: TaskStatus; due_at: string; closed_as: string | null } | null;
    if (!task) throw new ApiError(404, 'task_not_found', 'Không tìm thấy task.');
    if (task.owner_id !== req.actorId) throw new ApiError(403, 'not_owner', 'Chỉ người phụ trách task mới trả lời được.');
    if (task.closed_as || task.status === 'cancelled' || task.status === 'overdue') throw new ApiError(409, 'task_closed', 'Task đã đóng.');

    // A blocker reported between checkpoints also answers the checkpoint that is waiting, if any.
    if (!cp && req.answer === 'blocked') {
      const pending = must(
        await ctx.db
          .from('checkpoints')
          .select('id, task_id, pct, sent_at, answered_at, expired_at, token')
          .eq('task_id', task.id)
          .not('sent_at', 'is', null)
          .is('answered_at', null)
          .is('expired_at', null)
          .order('pct', { ascending: false })
          .limit(1),
        'pending checkpoint',
      ) as CpRow[];
      cp = pending[0] ?? null;
    }

    const milestones = must(await ctx.db.from('milestones').select('idx, done_at').eq('task_id', task.id), 'load milestones') as { idx: number; done_at: string | null }[];
    const doneCount = milestones.filter((m) => m.done_at).length;
    const k = cp ? checkpointIndex(cp.pct) : null;
    let effect;
    try {
      effect = answerEffect({ doneCount, status: task.status }, k, req.answer, req.reason);
    } catch (err) {
      const m = (err as Error).message;
      throw new ApiError(400, 'invalid_answer', /reason/.test(m) ? 'Hãy nhập lý do bị chặn.' : m);
    }
    const res = await ctx.db.rpc('ops_apply_answer', {
      p: {
        task_id: task.id,
        checkpoint_id: cp?.id ?? null,
        expected_done: doneCount,
        expected_status: task.status,
        answer: req.answer,
        reason: req.reason?.trim() || null,
        evidence_url: evidence,
        milestone_idx: k,
        via: req.via,
        actor: req.actorId,
        effect,
      },
    });
    if (res.error && /conflict/.test(res.error.message)) continue;
    const out = must(res, 'apply answer') as { status: TaskStatus; alert_id: string | null };
    if (out.alert_id) await notifyAlert(ctx, out.alert_id);
    return {
      taskId: task.id,
      taskName: task.name,
      status: out.status,
      doneCount: effect.doneCount,
      alertId: out.alert_id,
      checkpointPct: cp?.pct ?? null,
      milestoneIdx: k,
    };
  }
  throw new ApiError(409, 'conflict', 'Dữ liệu vừa thay đổi, hãy thử lại.');
}
