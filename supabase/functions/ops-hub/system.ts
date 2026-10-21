// Admin tools: invite users, health check, Telegram connection, test message.
import { DOMAIN_VERSION, ROLE_LABEL, Role, runDomainCases } from '../../../src/domain/index';
import { Ctx, loadSettings, Profile, requireRole } from './context';
import { ApiError, must } from './http';
import { deriveWebhookSecret } from './telegram';

const ROLES = Object.keys(ROLE_LABEL) as Role[];

export async function inviteUser(ctx: Ctx, user: Profile, body: Record<string, unknown>) {
  requireRole(user, 'admin');
  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim();
  const role = String(body.role ?? '') as Role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'bad_email', 'Email không hợp lệ.');
  if (!ROLES.includes(role)) throw new ApiError(400, 'bad_role', 'Vai trò không hợp lệ.');
  const { data, error } = await ctx.db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { ops_role: role },
    user_metadata: { full_name: fullName },
  });
  if (error) {
    if (/already|exists|registered/i.test(error.message)) throw new ApiError(409, 'exists', 'Email này đã có tài khoản. Đổi vai trò ở bảng bên dưới.');
    throw new ApiError(400, 'invite_failed', `Không tạo được tài khoản: ${error.message}`);
  }
  const id = data.user!.id;
  must(await ctx.db.from('profiles').update({ full_name: fullName, role, active: true }).eq('id', id).select('id'), 'set profile');
  await ctx.db.from('events').insert({ actor: user.id, entity: 'profiles', entity_id: id, action: 'user.invited', payload: { email, role } });
  return { user_id: id };
}

function expectedWebhookUrl(ctx: Ctx): string {
  return `${ctx.env.functionsBase}/ops-hub/telegram-webhook`;
}

export async function systemHealth(ctx: Ctx, user: Profile) {
  requireRole(user, 'admin');
  const s = await loadSettings(ctx.db);
  const cron = await ctx.db.rpc('ops_cron_secret');
  const telegram: Record<string, unknown> = { configured: !!ctx.tg };
  if (ctx.tg) {
    const [me, hook] = await Promise.all([ctx.tg.getMe(), ctx.tg.getWebhookInfo()]);
    telegram.tokenValid = me.ok;
    telegram.username = me.result?.username ?? null;
    telegram.webhookUrl = hook.result?.url ?? null;
    telegram.webhookExpected = expectedWebhookUrl(ctx);
    telegram.webhookOk = hook.ok && hook.result?.url === expectedWebhookUrl(ctx);
    telegram.pending = hook.result?.pending_update_count ?? null;
    telegram.lastError = hook.result?.last_error_message ?? null;
    telegram.lastErrorAt = hook.result?.last_error_date ? new Date(hook.result.last_error_date * 1000).toISOString() : null;
    if (me.ok && me.result?.username && me.result.username !== s.telegram_bot_username) {
      await ctx.db.from('settings').update({ telegram_bot_username: me.result.username }).eq('id', 1);
    }
  }
  return {
    domainVersion: DOMAIN_VERSION,
    cases: runDomainCases(),
    appEnv: ctx.env.appEnv,
    cronSecretConfigured: !cron.error && !!cron.data,
    telegram,
    systemStatus: s.system_status ?? {},
    serverTime: new Date(ctx.now()).toISOString(),
  };
}

export async function connectTelegram(ctx: Ctx, user: Profile) {
  requireRole(user, 'admin');
  if (!ctx.tg || !ctx.env.telegramToken) throw new ApiError(400, 'no_token', 'Chưa có TELEGRAM_BOT_TOKEN trong Edge Function Secrets.');
  const me = await ctx.tg.getMe();
  if (!me.ok) throw new ApiError(400, 'bad_token', `Token Telegram không hợp lệ: ${me.description ?? ''}`);
  const secret = ctx.env.webhookSecretOverride ?? (await deriveWebhookSecret(ctx.env.telegramToken));
  const url = expectedWebhookUrl(ctx);
  const res = await ctx.tg.setWebhook(url, secret);
  if (!res.ok) throw new ApiError(400, 'webhook_failed', `Telegram từ chối webhook: ${res.description ?? ''}`);
  await ctx.db.from('settings').update({ telegram_bot_username: me.result?.username ?? null }).eq('id', 1);
  await ctx.db.from('events').insert({ actor: user.id, entity: 'settings', entity_id: '1', action: 'telegram.webhook_set', payload: { url, username: me.result?.username } });
  return { ok: true, url, username: me.result?.username ?? null };
}

export async function testMessage(ctx: Ctx, user: Profile) {
  const res = await ctx.notifier.send(user.id, `Tin nhắn thử từ <b>Go Media Ops Hub</b>.\nTài khoản: ${user.full_name || user.email} (${ROLE_LABEL[user.role]}). Bot đã nhắn được cho bạn.`);
  if (!res.delivered) {
    const why = res.reason === 'not_linked' ? 'Bạn chưa liên kết Telegram.' : res.reason === 'no_channel' ? 'Máy chủ chưa có token bot.' : `Telegram báo lỗi: ${res.reason ?? ''}`;
    throw new ApiError(400, 'not_delivered', why);
  }
  return { ok: true };
}
