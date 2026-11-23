// One-off integration check of the 1.7.0 server code (quotes.ts + work.ts) against the Pilot project.
// Deployed as a separate function, called once with the cron secret, then replaced by a stub.
// It plays Account, PM and CEO on quotes with codes ZZ-TEST-*, project ZZ8, checks each step,
// and deletes everything it created. Notifications go to a no-op notifier.
import { createClient } from '@supabase/supabase-js';
import { readEnv } from '../../supabase/functions/ops-hub/env';
import type { Ctx, Profile } from '../../supabase/functions/ops-hub/context';
import * as Q from '../../supabase/functions/ops-hub/quotes';
import * as W from '../../supabase/functions/ops-hub/work';
import { localDateKey, shiftKey } from '../../src/domain/index';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): unknown };

Deno.serve(async (req) => {
  const env = readEnv((k) => Deno.env.get(k));
  const db = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } });
  const secret = await db.rpc('ops_cron_secret');
  if (!secret.data || req.headers.get('x-cron-secret') !== secret.data) return new Response('unauthorized', { status: 401 });

  const sent: { to: string; text: string }[] = [];
  const notifier = {
    send: async (to: string, text: string) => void sent.push({ to, text }),
    sendToRoles: async (roles: string[], text: string) => (sent.push({ to: roles.join(','), text }), 1),
  };
  // A fixed working-hour clock (15:00 today, Vietnam time), so notices are sent instead of queued.
  const nowVn = new Date(Date.now() + 7 * 3600e3);
  const clock = Date.UTC(nowVn.getUTCFullYear(), nowVn.getUTCMonth(), nowVn.getUTCDate(), 8, 0);
  const ctx = { env, db, tg: null, notifier, now: () => Math.max(clock, Date.now()) } as unknown as Ctx;
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
  const status = async (id: string) => (await db.from('quotes').select('status, approver, signed_at, sent_at, outcome, handover_pm, kind').eq('id', id).single()).data as Record<string, string | null>;

  try {
    const profiles = ((await db.from('profiles').select('id, email, full_name, role, active, telegram_chat_id, tg_state').eq('active', true)).data ?? []) as Profile[];
    const account = profiles.find((p) => p.role === 'account' && p.email.startsWith('long.nguyen230608@')) ?? profiles.find((p) => p.role === 'account');
    const account2 = profiles.find((p) => p.role === 'account' && p.id !== account?.id);
    const pm = profiles.find((p) => p.role === 'pm' && p.email.includes('+pm@')) ?? profiles.find((p) => p.role === 'pm');
    const pm2 = profiles.find((p) => p.role === 'pm' && p.id !== pm?.id);
    const ceo = profiles.find((p) => p.role === 'ceo');
    if (!account || !pm || !ceo) throw new Error('need active account, pm, ceo');
    const lib = ((await db.from('library_items').select('id, name, unit, unit_price, kind').eq('active', true).eq('kind', 'service').order('unit_price').limit(2)).data ?? []) as { id: string; name: string; unit: string; unit_price: number }[];
    if (lib.length < 2) throw new Error('need 2 active library items');
    const terms = ((await db.from('quote_terms').select('text, choice_group').eq('active', true)).data ?? []) as { text: string; choice_group: string | null }[];
    const pay = terms.filter((t) => t.choice_group);
    ok('payment terms grouped', pay.length >= 2, pay.map((t) => t.text.slice(0, 20)));

    const makeQuote = async (code: string, kind: 'quick' | 'project', discount = 0) => {
      const q = (await db.from('quotes').insert({ code, client: 'ZZ Selftest', project: 'Dự án selftest', venue: 'Đà Nẵng', contact: 'Chị A', requested_at: new Date(Date.now() - 3600e3).toISOString(), created_by: account.id, kind, discount_pct: discount }).select('id, terms').single()).data as { id: string; terms: string[] };
      await db.from('quote_lines').insert(lib.map((l, i) => ({ quote_id: q.id, position: i + 1, library_item_id: l.id, item_name: l.name, unit: l.unit, qty: 1, unit_price: l.unit_price, library_price: l.unit_price })));
      return q;
    };

    // ---------------- project quote: always reviewed and signed ----------------
    const p = await makeQuote('ZZ-TEST-01', 'project');
    ok('default terms: one payment schedule', (p.terms ?? []).filter((t) => pay.some((x) => x.text === t)).length === 1, p.terms);
    await db.from('quotes').update({ terms: [...(p.terms ?? []), ...pay.map((t) => t.text)] }).eq('id', p.id);
    await fails('two payment terms block submitting', () => Q.submitQuote(ctx, account, p.id), /chỉ chọn 1/);
    await db.from('quotes').update({ terms: p.terms }).eq('id', p.id);
    await fails('project quote cannot be sent from draft', () => Q.sendQuote(ctx, account, p.id), /duyệt và CEO ký/);
    await Q.submitQuote(ctx, account, p.id);
    let s = await status(p.id);
    ok('project quote → pending, CEO decides (even inside the band)', s.status === 'pending' && s.approver === 'ceo', s);
    ok('PMs and CEO notified to comment/decide', sent.some((m) => m.to === 'ceo,pm'));
    await fails('PM cannot approve a project quote', () => Q.decideQuote(ctx, pm, { quote_id: p.id, decision: 'approve' }), /chờ CEO/);
    await Q.decideQuote(ctx, ceo, { quote_id: p.id, decision: 'approve' });
    s = await status(p.id);
    ok('CEO approve → Chờ CEO ký', s.status === 'signing', s);
    await fails('cannot send while waiting for the signature', () => Q.sendQuote(ctx, account, p.id), /chờ CEO ký/);
    await fails('PM cannot sign', () => Q.signQuote(ctx, pm, p.id), /./);
    await Q.decideQuote(ctx, ceo, { quote_id: p.id, decision: 'changes', comment: 'Sửa tên dự án' });
    s = await status(p.id);
    ok('CEO can send it back at the signing step', s.status === 'changes_requested', s);
    await Q.reopenQuote(ctx, account, p.id);
    await Q.submitQuote(ctx, account, p.id);
    await Q.decideQuote(ctx, ceo, { quote_id: p.id, decision: 'approve' });
    await Q.signQuote(ctx, ceo, p.id);
    s = await status(p.id);
    ok('CEO sign → approved with signed_at', s.status === 'approved' && !!s.signed_at, s);
    await Q.sendQuote(ctx, account, p.id);
    s = await status(p.id);
    ok('Account sends after signing', s.status === 'sent' && !!s.sent_at, s);

    // ---------------- client answer ----------------
    if (account2) await fails('another Account cannot record the answer', () => Q.setQuoteOutcome(ctx, account2, { quote_id: p.id, outcome: 'won', handover_pm: pm.id }), /Chỉ Account/);
    await fails('won needs a PM', () => Q.setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: 'won' }), /Chọn PM/);
    await fails('lost needs a reason', () => Q.setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: 'lost' }), /lý do/);
    await Q.setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: 'lost', lost_reason: 'price', lost_note: 'thử' });
    s = await status(p.id);
    ok('lost saved', s.outcome === 'lost', s);
    await Q.setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: 'won', handover_pm: pm.id });
    s = await status(p.id);
    ok('changed to won, PM set', s.outcome === 'won' && s.handover_pm === pm.id, s);
    ok('PM notified with a link to create the project', sent.some((m) => m.to === pm.id && /tạo dự án/.test(m.text)));

    // ---------------- project from quote ----------------
    const today = localDateKey(Date.now(), 'Asia/Ho_Chi_Minh');
    if (pm2) await fails('another PM cannot take this quote', () => W.createProject(ctx, pm2, { code: 'ZZ8', name: 'x', due_date: shiftKey(today, 20), quote_id: p.id }), /PM khác/);
    await fails('Account cannot create a project', () => W.createProject(ctx, account, { code: 'ZZ8', name: 'x', due_date: shiftKey(today, 20), quote_id: p.id }), /Chỉ PM/);
    const { project } = await W.createProject(ctx, pm, { code: 'ZZ8', name: 'Dự án selftest', client: 'ZZ Selftest', start_date: today, due_date: shiftKey(today, 20), quote_id: p.id });
    const link = (await db.from('project_quotes').select('project_id').eq('quote_id', p.id).maybeSingle()).data as { project_id: string } | null;
    ok('project created and linked to the quote', link?.project_id === project.id, link);
    await fails('answer locked once a project exists', () => Q.setQuoteOutcome(ctx, account, { quote_id: p.id, outcome: 'lost', lost_reason: 'price' }), /đã có dự án/);
    await fails('a quote belongs to one project', () => W.linkQuote(ctx, pm, { project_id: project.id, quote_id: p.id }), /đã thuộc/);

    // ---------------- quick quotes ----------------
    const fast = await makeQuote('ZZ-TEST-02', 'quick');
    await Q.sendQuote(ctx, account, fast.id);
    s = await status(fast.id);
    ok('quick quote inside the band goes out without signing', s.status === 'sent' && !s.signed_at, s);
    await fails('cannot attach a quote that is not won', () => W.linkQuote(ctx, pm, { project_id: project.id, quote_id: fast.id }), /đã chốt/);
    await Q.setQuoteOutcome(ctx, account, { quote_id: fast.id, outcome: 'won', handover_pm: pm.id });
    await W.linkQuote(ctx, pm, { project_id: project.id, quote_id: fast.id });
    ok('second quote attached to the same project', ((await db.from('project_quotes').select('quote_id').eq('project_id', project.id)).data ?? []).length === 2);

    const off = await makeQuote('ZZ-TEST-03', 'quick', 60);
    await fails('quick quote outside the band cannot be sent directly', () => Q.sendQuote(ctx, account, off.id), /duyệt/);
    await Q.submitQuote(ctx, account, off.id);
    s = await status(off.id);
    ok('outside the band → pending with a PM or CEO approver', s.status === 'pending' && (s.approver === 'pm' || s.approver === 'ceo'), s);
    const approver = s.approver === 'pm' ? pm : ceo;
    await Q.decideQuote(ctx, approver, { quote_id: off.id, decision: 'approve' });
    ok('approved → Chờ CEO ký', (await status(off.id)).status === 'signing');
    ok('CEO asked to sign', sent.some((m) => m.to === 'ceo' && /chờ CEO ký/i.test(m.text)), sent.map((m) => m.to));
    const queued = ((await db.from('quotes').select('approval_notified_at').eq('id', off.id).single()).data as { approval_notified_at: string | null }).approval_notified_at;
    ok('signing notice marked as sent', !!queued);
    await Q.signQuote(ctx, ceo, off.id);
    await Q.sendQuote(ctx, account, off.id);
    ok('signed quick quote sent', (await status(off.id)).status === 'sent');
  } catch (e) {
    log.push({ step: 'exception', ok: false, detail: `${(e as Error).message}\n${(e as Error).stack}` });
  } finally {
    const zz = ((await db.from('lark_tasks').select('id').like('code', 'ZZ8%')).data ?? []).map((r: { id: string }) => r.id);
    if (zz.length) await db.from('bot_messages').delete().in('project_id', zz);
    await db.from('lark_tasks').delete().like('code', 'ZZ8%');
    const ids = ((await db.from('quotes').select('id').like('code', 'ZZ-TEST-%')).data ?? []).map((r: { id: string }) => r.id);
    if (ids.length) {
      await db.from('approvals').delete().in('quote_id', ids);
      await db.from('quote_comments').delete().in('quote_id', ids);
      await db.from('quotes').delete().in('id', ids);
    }
    const left = ((await db.from('quotes').select('id').like('code', 'ZZ-TEST-%')).data ?? []).length + ((await db.from('lark_tasks').select('id').like('code', 'ZZ8%')).data ?? []).length;
    log.push({ step: 'cleanup', ok: left === 0, detail: { left } });
  }
  const failed = log.filter((l) => !l.ok);
  return new Response(JSON.stringify({ passed: log.length - failed.length, failed: failed.length, log }, null, 1), { headers: { 'content-type': 'application/json' } });
});
