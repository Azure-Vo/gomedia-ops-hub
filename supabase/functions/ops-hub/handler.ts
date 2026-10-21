// Router for the single Edge Function "ops-hub":
//   POST /ops-hub/api                    actions from the web app (user JWT)
//   POST /ops-hub/telegram-webhook       Telegram updates (secret-token header)
//   POST /ops-hub/dispatch-checkpoints   pg_cron every 15 min (x-cron-secret)
//   POST /ops-hub/close-tasks            pg_cron every 15 min (x-cron-secret)
//   GET  /ops-hub/health                 liveness + domain version
import { createClient } from '@supabase/supabase-js';
import { DOMAIN_VERSION } from '../../../src/domain/index';
import { Ctx, loadProfile } from './context';
import { seedDemo, clearDemo } from './demo';
import type { Env } from './env';
import { ApiError, fail, json, preflight, safeEqual } from './http';
import { closeTasks, dispatchCheckpoints } from './jobs';
import { makeChannel, Notifier } from './notify';
import { decideQuote, importQuotes, previewBand, reopenQuote, sendQuote, submitQuote } from './quotes';
import { connectTelegram, inviteUser, systemHealth, testMessage } from './system';
import { deriveWebhookSecret, TelegramApi } from './telegram';
import { handleTelegramUpdate } from './telegram-webhook';
import { answerOnWeb, cancelTask, createTask, importTasks, reportBlockerOnWeb, updateTaskPlan } from './tasks';

export interface HandlerOptions {
  fetchImpl?: typeof fetch;
  /** Test clock. Only honoured when allowTestClock is true (never in production). */
  allowTestClock?: boolean;
}

function routeOf(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

async function requireCron(ctx: Ctx, req: Request) {
  const got = req.headers.get('x-cron-secret');
  const { data, error } = await ctx.db.rpc('ops_cron_secret');
  if (error || !data || !safeEqual(got, data as string)) throw new ApiError(401, 'unauthorized', 'Missing or wrong x-cron-secret');
}

async function handleApi(ctx: Ctx, req: Request) {
  if (req.method !== 'POST') throw new ApiError(405, 'method', 'POST only');
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new ApiError(401, 'unauthenticated', 'Bạn cần đăng nhập.');
  const { data, error } = await ctx.db.auth.getUser(token);
  if (error || !data?.user) throw new ApiError(401, 'unauthenticated', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
  const user = await loadProfile(ctx.db, data.user.id);
  if (!user || !user.active) throw new ApiError(403, 'inactive', 'Tài khoản chưa được cấp quyền hoặc đã bị khoá.');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.quote_id ?? '');
  switch (body.action) {
    case 'quote.band':
      return previewBand(ctx, user, body);
    case 'quote.submit':
      return submitQuote(ctx, user, id);
    case 'quote.reopen':
      return reopenQuote(ctx, user, id);
    case 'quote.decide':
      return decideQuote(ctx, user, body);
    case 'quote.send':
      return sendQuote(ctx, user, id);
    case 'quote.import':
      return importQuotes(ctx, user, body);
    case 'task.create':
      return createTask(ctx, user, body);
    case 'task.update':
      return updateTaskPlan(ctx, user, body);
    case 'task.cancel':
      return cancelTask(ctx, user, body);
    case 'task.import':
      return importTasks(ctx, user, body);
    case 'checkin.answer':
      return answerOnWeb(ctx, user, body);
    case 'checkin.blocker':
      return reportBlockerOnWeb(ctx, user, body);
    case 'admin.invite':
      return inviteUser(ctx, user, body);
    case 'system.health':
      return systemHealth(ctx, user);
    case 'system.connect_telegram':
      return connectTelegram(ctx, user);
    case 'system.test_message':
      return testMessage(ctx, user);
    case 'system.run_jobs':
      if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Chỉ admin.');
      return { dispatch: await dispatchCheckpoints(ctx), close: await closeTasks(ctx) };
    case 'demo.seed':
      return seedDemo(ctx, user);
    case 'demo.clear':
      return clearDemo(ctx, user);
    default:
      throw new ApiError(400, 'unknown_action', `Unknown action: ${String(body.action)}`);
  }
}

async function handleWebhook(ctx: Ctx, req: Request) {
  if (!ctx.tg || !ctx.env.telegramToken) return json({ ok: false, reason: 'telegram not configured' });
  const expected = ctx.env.webhookSecretOverride ?? (await deriveWebhookSecret(ctx.env.telegramToken));
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token'), expected)) return json({ error: 'forbidden' }, 401);
  const update = await req.json().catch(() => null);
  if (update) {
    try {
      await handleTelegramUpdate(ctx, update);
    } catch (err) {
      console.error('telegram update failed', err);
    }
  }
  return json({ ok: true });
}

export function createHandler(env: Env, opts: HandlerOptions = {}) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight(req);
    const route = routeOf(req.url);
    if (route === 'health') return json({ ok: true, domainVersion: DOMAIN_VERSION, appEnv: env.appEnv });
    if (!env.supabaseUrl || !env.serviceKey) return json({ error: { code: 'config', message: 'SUPABASE_URL / service key missing' } }, 500);
    const fixed = opts.allowTestClock ? req.headers.get('x-test-now') : null;
    const now = fixed ? () => Date.parse(fixed) : Date.now;
    const db = createClient(env.supabaseUrl, env.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: opts.fetchImpl ? { fetch: opts.fetchImpl } : undefined,
    });
    const tg = env.telegramToken ? new TelegramApi(env.telegramToken, env.telegramApiBase, opts.fetchImpl ?? fetch) : null;
    const ctx: Ctx = { env, db, tg, notifier: new Notifier(db, makeChannel(tg)), now };
    try {
      switch (route) {
        case 'api':
          return json(await handleApi(ctx, req));
        case 'telegram-webhook':
          return await handleWebhook(ctx, req);
        case 'dispatch-checkpoints':
          await requireCron(ctx, req);
          return json(await dispatchCheckpoints(ctx));
        case 'close-tasks':
          await requireCron(ctx, req);
          return json(await closeTasks(ctx));
        default:
          return json({ error: { code: 'not_found', message: `Unknown route ${route}` } }, 404);
      }
    } catch (err) {
      return fail(err);
    }
  };
}
