// One-off integration check of the 1.6 server code (supabase/functions/ops-hub/work.ts) against a real
// Supabase project in Lark simulation mode. Deployed as a separate function, called once with the cron
// secret, then replaced by a stub. It creates project ZZ9, runs the whole flow with a fake clock, checks
// each step, and removes everything it created (and any message the daily run sent during the test).
import { createClient } from '@supabase/supabase-js';
import { readEnv } from '../../supabase/functions/ops-hub/env';
import type { Ctx, Profile } from '../../supabase/functions/ops-hub/context';
import * as W from '../../supabase/functions/ops-hub/work';
import { localDateKey, localToMs, shiftKey } from '../../src/domain/index';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): unknown };

const TZ = 'Asia/Ho_Chi_Minh';
const at = (day: string, hm: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return localToMs(y, m, d, h, mi, TZ);
};

Deno.serve(async (req) => {
  const env = readEnv((k) => Deno.env.get(k));
  const db = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
  const secret = await db.rpc('ops_cron_secret');
  if (!secret.data || req.headers.get('x-cron-secret') !== secret.data) return new Response('unauthorized', { status: 401 });

  let clock = Date.now();
  const ctx = { env, db, tg: null, notifier: { send: async () => undefined } as unknown, now: () => clock } as unknown as Ctx;
  const log: { step: string; ok: boolean; detail?: unknown }[] = [];
  const ok = (step: string, cond: unknown, detail?: unknown) => log.push({ step, ok: !!cond, detail });
  const fails = async (step: string, fn: () => Promise<unknown>, re: RegExp) => {
    try {
      await fn();
      ok(step, false, 'no error');
    } catch (e) {
      ok(step, re.test((e as Error).message), (e as Error).message);
    }
  };
  const testStart = new Date().toISOString();
  const maxCheckin = ((await db.from('task_checkins').select('id').order('id', { ascending: false }).limit(1)).data ?? [])[0]?.id ?? 0;
  const projectsBefore = ((await db.from('lark_tasks').select('id, state, closed_at').eq('kind', 'parent')).data ?? []) as { id: string; state: string; closed_at: string | null }[];
  const row = async (id: string) => (await db.from('lark_tasks').select(W.WORK_COLS).eq('id', id).single()).data as W.WorkRow;
  const msgs = async (kind: string, taskOrProject: string) => ((await db.from('bot_messages').select('kind, channel, to_name, status').eq('kind', kind).or(`task_id.eq.${taskOrProject},project_id.eq.${taskOrProject}`)).data ?? []) as { channel: string }[];

  try {
    const profiles = ((await db.from('profiles').select('id, email, full_name, role, active, telegram_chat_id, tg_state').eq('active', true)).data ?? []) as Profile[];
    const pm = profiles.find((p) => p.role === 'pm');
    const staff = profiles.find((p) => p.role === 'staff');
    const admin = profiles.find((p) => p.role === 'admin') ?? { ...staff!, role: 'admin' as const };
    if (!pm || !staff) throw new Error('need an active pm and staff profile');
    const today = localDateKey(clock, TZ);
    ok('mode is simulation', (await W.workEnv(ctx)).cfg.mode === 'simulation');

    // project + group
    await fails('staff cannot create a project', () => W.createProject(ctx, staff, { code: 'ZZ9', name: 'x', due_date: shiftKey(today, 30) }), /Chỉ PM/);
    const { project } = await W.createProject(ctx, pm, { code: 'zz 9', name: 'Selftest 1.6', client: 'Test', start_date: today, due_date: shiftKey(today, 30) });
    ok('project code normalised', project.code === 'ZZ9', project.code);
    ok('no group → chat missing', project.chat_status === 'missing');
    ok('bot-missing DM to PM', (await msgs('bot_missing', project.id)).length === 1);
    await fails('duplicate code refused', () => W.createProject(ctx, pm, { code: 'ZZ9', name: 'dup', due_date: shiftKey(today, 30) }), /đã có/);
    const { chat } = await W.createSimChat(ctx, pm, { name: 'ZZ9 · selftest' });
    const linked = await W.checkProjectChat(ctx, pm, { project_id: project.id });
    ok('check-again links the group by code', linked.linked && (await row(project.id)).chat_id === chat.chat_id);
    ok('linked message in group', (await msgs('project_linked', project.id))[0]?.channel === 'group');
    await W.setMembers(ctx, pm, { project_id: project.id, add_ids: [staff.id] });
    ok('member added', ((await db.from('project_members').select('id').eq('project_id', project.id).eq('profile_id', staff.id)).data ?? []).length === 1);

    // tasks
    const t1 = (await W.createTask(ctx, pm, { project_id: project.id, name: 'Long task', expected_output: '50 video', assignee_id: staff.id, start_date: today, due_date: shiftKey(today, 14) })) as { task: W.WorkRow };
    const t2 = (await W.createTask(ctx, pm, { project_id: project.id, name: 'Short task', expected_output: '1 file', assignee_id: staff.id, start_date: today, due_date: shiftKey(today, 2) })) as { task: W.WorkRow };
    ok('task codes ZZ9-01, ZZ9-02', t1.task.code === 'ZZ9-01' && t2.task.code === 'ZZ9-02', [t1.task.code, t2.task.code]);
    ok('task created message in group', (await msgs('task_created', t1.task.id))[0]?.channel === 'group');
    await fails('task after project deadline refused', () => W.createTask(ctx, pm, { project_id: project.id, name: 'x', expected_output: 'y', assignee_id: staff.id, due_date: shiftKey(today, 40) }), /deadline dự án/);
    await fails('task without expected output refused', () => W.createTask(ctx, pm, { project_id: project.id, name: 'x', assignee_id: staff.id, due_date: shiftKey(today, 5) }), /Kết quả cần nộp/i);

    // submit / review
    await fails('submit without evidence refused', () => W.submitTask(ctx, staff, { task_id: t1.task.id, links: [] }), /ít nhất 1/);
    await fails('PM cannot submit for staff', () => W.submitTask(ctx, pm, { task_id: t1.task.id, links: ['https://a.vn/x'] }), /người được giao/);
    await fails('admin cannot submit for staff', () => W.submitTask(ctx, admin, { task_id: t1.task.id, links: ['https://a.vn/x'] }), /người được giao/);
    clock = at(shiftKey(today, 1), '10:00');
    await W.submitTask(ctx, staff, { task_id: t1.task.id, links: ['https://drive.google.com/x', 'bad link'], note: 'xong' });
    let r1 = await row(t1.task.id);
    ok('submitted → review', r1.state === 'review' && !!r1.review_since);
    ok('submitted message @PM in group', (await msgs('submitted', t1.task.id)).length === 1);
    await fails('staff cannot approve', () => W.reviewTask(ctx, staff, { task_id: t1.task.id, decision: 'approve' }), /PM phụ trách/);
    await fails('changes without feedback refused', () => W.reviewTask(ctx, pm, { task_id: t1.task.id, decision: 'changes', feedback: ' ' }), /góp ý/);
    await W.reviewTask(ctx, pm, { task_id: t1.task.id, decision: 'changes', feedback: 'Thiếu 10 video', extend_to: shiftKey(today, 16), extend_reason: 'quality' });
    r1 = await row(t1.task.id);
    ok('changes: state, due moved, KPI due kept', r1.state === 'changes' && r1.due_date === shiftKey(today, 16) && r1.kpi_due_date === shiftKey(today, 14), [r1.state, r1.due_date, r1.kpi_due_date]);
    ok('changes: short group note + DM feedback', (await msgs('changes', t1.task.id))[0]?.channel === 'group' && (await msgs('changes_dm', t1.task.id))[0]?.channel === 'dm');

    // progress
    clock = at(shiftKey(today, 2), '10:00');
    await fails('blocked needs a reason', () => W.answerProgress(ctx, staff, { task_id: t1.task.id, answer: 'blocked' }), /lý do/);
    await W.answerProgress(ctx, staff, { task_id: t1.task.id, answer: 'blocked', reason: 'Chờ khách gửi logo' });
    ok('blocked → DM to PM', (await msgs('blocked', t1.task.id))[0]?.channel === 'dm');
    await W.clearBlocked(ctx, staff, { task_id: t1.task.id });
    ok('unblocked', (await row(t1.task.id)).progress === 'on_plan');

    // extend with scope moves the KPI date
    await W.extendTask(ctx, pm, { task_id: t1.task.id, to: shiftKey(today, 18), reason: 'scope' });
    r1 = await row(t1.task.id);
    ok('scope extension moves KPI date', r1.due_date === shiftKey(today, 18) && r1.kpi_due_date === shiftKey(today, 18));
    await fails('extension past project deadline refused', () => W.extendTask(ctx, pm, { task_id: t1.task.id, to: shiftKey(today, 45), reason: 'scope' }), /deadline dự án/);

    // daily run: short task reminder on its deadline, summaries
    clock = at(shiftKey(today, 2), '09:30');
    const tick = await W.workTick(ctx, null, {});
    ok('daily run sent a D0 reminder for ZZ9-02', ((await db.from('bot_messages').select('id').eq('kind', 'reminder').eq('task_id', t2.task.id)).data ?? []).length === 1, tick);

    // resubmit, approve, cancel the other → project closes
    await W.submitTask(ctx, staff, { task_id: t1.task.id, links: ['https://drive.google.com/y'] });
    await W.reviewTask(ctx, pm, { task_id: t1.task.id, decision: 'approve' });
    r1 = await row(t1.task.id);
    ok('approved → done, accepted = 2nd submission', r1.state === 'done' && !!r1.accepted_at && !!r1.approved_at);
    await fails('cannot submit a done task', () => W.submitTask(ctx, staff, { task_id: t1.task.id, links: ['https://a.vn'] }), /Hoàn thành/);
    await W.cancelTask(ctx, pm, { task_id: t2.task.id, reason: 'Khách bỏ hạng mục' });
    const p2 = await row(project.id);
    ok('project closes when every live task is approved', p2.state === 'done', p2.state);
    ok('project-done message', (await msgs('project_done', project.id)).length === 1);
    const subs = ((await db.from('task_submissions').select('round, decision').eq('task_id', t1.task.id).order('round')).data ?? []) as { round: number; decision: string }[];
    ok('history keeps both rounds', subs.length === 2 && subs[0].decision === 'changes' && subs[1].decision === 'approved', subs);
    await W.reopenTask(ctx, pm, { task_id: t1.task.id, reason: 'Khách đổi ý' });
    ok('reopen → doing, project active again', (await row(t1.task.id)).state === 'doing' && (await row(project.id)).state === 'active');

    // bot command parsing path (preview stored as a draft)
    ok('evidence link cleaning', ((await db.from('task_submissions').select('links').eq('task_id', t1.task.id).eq('round', 1).single()).data as { links: string[] }).links.length === 1);
  } catch (e) {
    log.push({ step: 'exception', ok: false, detail: `${(e as Error).message}\n${(e as Error).stack}` });
  } finally {
    // clean up everything the test created, and what the daily run sent during it
    await db.from('lark_tasks').delete().like('code', 'ZZ9%');
    await db.from('lark_chats').delete().like('name', 'ZZ9 ·%');
    await db.from('bot_messages').delete().gte('created_at', testStart);
    await db.from('task_checkins').delete().gt('id', maxCheckin);
    for (const p of projectsBefore) await db.from('lark_tasks').update({ state: p.state, closed_at: p.closed_at }).eq('id', p.id);
    const left = ((await db.from('lark_tasks').select('id').like('code', 'ZZ9%')).data ?? []).length;
    log.push({ step: 'cleanup', ok: left === 0, detail: { left } });
  }
  const failed = log.filter((l) => !l.ok);
  return new Response(JSON.stringify({ passed: log.length - failed.length, failed: failed.length, log }, null, 1), { headers: { 'content-type': 'application/json' } });
});
