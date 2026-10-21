// Configuration read from Supabase Edge Function secrets.

export interface Env {
  supabaseUrl: string;
  serviceKey: string;
  telegramToken: string | null;
  telegramApiBase: string;
  /** Explicit TELEGRAM_WEBHOOK_SECRET, or null to derive one from the bot token. */
  webhookSecretOverride: string | null;
  appEnv: 'pilot' | 'demo';
  /** Public address used by the function when it calls itself (defaults to supabaseUrl). */
  functionsBase: string;
}

/** Supabase provides SUPABASE_URL and a service key (legacy SUPABASE_SERVICE_ROLE_KEY or the new SUPABASE_SECRET_KEYS). */
export function readEnv(get: (key: string) => string | undefined): Env {
  const supabaseUrl = (get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  let serviceKey = get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) {
    const raw = get('SUPABASE_SECRET_KEYS');
    if (raw) {
      try {
        const keys = JSON.parse(raw) as Record<string, string>;
        serviceKey = keys.default ?? Object.values(keys)[0] ?? '';
      } catch {
        serviceKey = '';
      }
    }
  }
  const appEnv = (get('APP_ENV') ?? 'pilot').toLowerCase() === 'demo' ? 'demo' : 'pilot';
  return {
    supabaseUrl,
    serviceKey,
    telegramToken: get('TELEGRAM_BOT_TOKEN')?.trim() || null,
    telegramApiBase: (get('TELEGRAM_API_BASE') ?? 'https://api.telegram.org').replace(/\/$/, ''),
    webhookSecretOverride: get('TELEGRAM_WEBHOOK_SECRET')?.trim() || null,
    appEnv,
    functionsBase: (get('FUNCTIONS_BASE_URL') ?? `${supabaseUrl}/functions/v1`).replace(/\/$/, ''),
  };
}
