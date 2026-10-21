// Task actions: create, edit before tracking starts, cancel, import, and web check-ins.
import { Answer, CHECKPOINT_PCTS, checkpointTimes, validateTaskDraft, validateTaskRows, WorkCalendar } from '../../../src/domain/index';
import { applyAnswer } from './answers';
import { calendarOf, Ctx, loadSettings, Profile, requireRole } from './context';
import { ApiError, must, randomToken } from './http';

interface TaskInput {
  name: string;
  owner_id: string | null;
  type_id: string | null;
  start_at: number | null;
  due_at: number | null;
  milestones: string[];
  priority_note: string | null;
}

function parseTask(body: Record<string, unknown>): TaskInput {
  const ms = Array.isArray(body.milestones) ? (body.milestones as unknown[]).map((m) => String(m ?? '').trim()) : [];
  const time = (v: unknown) => {
    const t = typeof v === 'string' || typeof v === 'number' ? new Date(v).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  };
  return {
    name: String(body.name ?? '').trim(),
    owner_id: body.owner_id ? String(body.owner_id) : null,
    type_id: body.type_id ? String(body.type_id) : null,
    start_at: time(body.start_at),
    due_at: time(body.due_at),
    milestones: ms,
    priority_note: body.priority_note ? String(body.priority_note).trim() : null,
  };
}

async function checkOwner(ctx: Ctx, ownerId: string | null) {
  if (!ownerId) return;
  const p = (await ctx.db.from('profiles').select('id, active').eq('id', ownerId).maybeSingle()).data as { active: boolean } | null;
  if (!p || !p.active) throw new ApiError(400, 'bad_owner', 'Người phụ trách không tồn tại hoặc đã bị khoá.');
}

function plan(t: TaskInput, cal: WorkCalendar, now: number) {
  const errors = validateTaskDraft({ name: t.name, ownerId: t.owner_id, startAt: t.start_at, dueAt: t.due_at, milestones: t.milestones, now }, cal);
  if (errors.length) throw new ApiError(400, 'invalid_task', errors.join(' '));
  return checkpointTimes(t.start_at as number, t.due_at as number, cal).map((d, i) => ({ pct: CHECKPOINT_PCTS[i], scheduled_at: d.toISOString() }));
}

async function insertTask(ctx: Ctx, actor: string, t: TaskInput, cal: WorkCalendar, source: 'app' | 'import') {
  const checkpoints = plan(t, cal, ctx.now()).map((c) => ({ ...c, token: randomToken() }));
  const id = must(
    await ctx.db.rpc('ops_create_task', {
      p: {
        name: t.name,
        owner_id: t.owner_id,
        type_id: t.type_id,
        start_at: new Date(t.start_at as number).toISOString(),
        due_at: new Date(t.due_at as number).toISOString(),
        priority_note: t.priority_note,
        actor,
        source,
        milestones: t.milestones,
        checkpoints,
      },
    }),
    'create task',
  ) as string;
  return { task_id: id, checkpoints: checkpoints.map(({ pct, scheduled_at }) => ({ pct, scheduled_at })) };
}

export async function createTask(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'ecom_exec', 'admin');
  const t = parseTask(body);
  await checkOwner(ctx, t.owner_id);
  const cal = calendarOf(await loadSettings(ctx.db));
  return insertTask(ctx, user.id, t, cal, 'app');
}

/** Allowed until the first check-in has gone out (the SQL function refuses after that). */
export async function updateTaskPlan(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'ecom_exec', 'admin');
  const taskId = String(body.task_id ?? '');
  const t = parseTask(body);
  await checkOwner(ctx, t.owner_id);
  const cal = calendarOf(await loadSettings(ctx.db));
  const checkpoints = plan(t, cal, ctx.now());
  const res = await ctx.db.rpc('ops_update_task_plan', {
    p: {
      task_id: taskId,
      name: t.name,
      owner_id: t.owner_id,
      type_id: t.type_id,
      start_at: new Date(t.start_at as number).toISOString(),
      due_at: new Date(t.due_at as number).toISOString(),
      priority_note: t.priority_note,
      milestones: t.milestones,
      checkpoints,
      actor: user.id,
    },
  });
  if (res.error && /task_started/.test(res.error.message)) throw new ApiError(409, 'task_started', 'Task đã gửi check-in đầu tiên, không đổi kế hoạch được nữa. Có thể huỷ task và tạo task mới.');
  must(res, 'update task');
  return { task_id: taskId, checkpoints };
}

export async function cancelTask(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'ecom_exec', 'admin');
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw new ApiError(400, 'reason_required', 'Ghi lý do huỷ task.');
  const res = await ctx.db.rpc('ops_cancel_task', { p: { task_id: String(body.task_id ?? ''), reason, actor: user.id } });
  if (res.error && /task_closed/.test(res.error.message)) throw new ApiError(409, 'task_closed', 'Task đã đóng hoặc đã huỷ.');
  must(res, 'cancel task');
  return { ok: true };
}

export async function importTasks(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'ecom_exec', 'admin');
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length > 2000) throw new ApiError(400, 'bad_rows', 'File không hợp lệ hoặc quá lớn (tối đa 2000 dòng).');
  const s = await loadSettings(ctx.db);
  const cal = calendarOf(s);
  const parsed = validateTaskRows(rows as Record<string, string>[], cal.timeZone);
  const people = must(await ctx.db.from('profiles').select('id, email, full_name, active'), 'load people') as { id: string; email: string; full_name: string; active: boolean }[];
  const types = must(await ctx.db.from('task_types').select('id, name, milestone_1, milestone_2, milestone_3, milestone_4, active'), 'load types') as {
    id: string;
    name: string;
    milestone_1: string;
    milestone_2: string;
    milestone_3: string;
    milestone_4: string;
    active: boolean;
  }[];
  const errors = [...parsed.errors];
  const ready: TaskInput[] = [];
  parsed.rows.forEach((r) => {
    const rowNo = r.row;
    const key = r.owner.toLowerCase();
    const owner = people.find((p) => p.active && (p.email.toLowerCase() === key || p.full_name.trim().toLowerCase() === key));
    const type = r.taskType ? types.find((t) => t.active && t.name.trim().toLowerCase() === r.taskType.toLowerCase()) : undefined;
    if (!owner) return errors.push({ row: rowNo, message: `không tìm thấy người phụ trách "${r.owner}" trong danh sách người dùng` });
    if (r.taskType && !type && !r.milestones) return errors.push({ row: rowNo, message: `không có loại task "${r.taskType}"` });
    const t: TaskInput = {
      name: r.name,
      owner_id: owner.id,
      type_id: type?.id ?? null,
      start_at: r.startAt,
      due_at: r.dueAt,
      milestones: r.milestones ?? [type!.milestone_1, type!.milestone_2, type!.milestone_3, type!.milestone_4],
      priority_note: r.priorityNote,
    };
    const problems = validateTaskDraft({ name: t.name, ownerId: t.owner_id, startAt: t.start_at, dueAt: t.due_at, milestones: t.milestones, now: ctx.now() }, cal);
    if (problems.length) return errors.push({ row: rowNo, message: problems.join(' ') });
    ready.push(t);
  });
  const preview = { valid: ready.length, errors: errors.sort((a, b) => a.row - b.row) };
  if (body.dryRun) return { preview };
  const created: string[] = [];
  for (const t of ready) created.push((await insertTask(ctx, user.id, t, cal, 'import')).task_id);
  return { preview, created: created.length };
}

export async function answerOnWeb(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  const answer = String(body.answer ?? '') as Answer;
  if (!['on_plan', 'behind', 'blocked'].includes(answer)) throw new ApiError(400, 'bad_answer', 'Câu trả lời không hợp lệ.');
  return applyAnswer(ctx, {
    actorId: user.id,
    checkpointId: Number(body.checkpoint_id),
    answer,
    reason: body.reason ? String(body.reason) : null,
    evidenceUrl: body.evidence_url ? String(body.evidence_url) : null,
    via: 'web',
  });
}

export async function reportBlockerOnWeb(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  return applyAnswer(ctx, { actorId: user.id, taskId: String(body.task_id ?? ''), answer: 'blocked', reason: String(body.reason ?? ''), via: 'web' });
}
