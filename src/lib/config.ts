// Runtime configuration. The static site reads /config.js (edited once per deployment),
// so the same build serves the Pilot and the Demo projects.
export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  environment: 'pilot' | 'demo';
}

declare global {
  interface Window {
    OPS_HUB_CONFIG?: Partial<AppConfig>;
  }
}

function read(): AppConfig {
  const w = (typeof window !== 'undefined' ? window.OPS_HUB_CONFIG : undefined) ?? {};
  const url = w.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
  const key = w.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '';
  const env = (w.environment || (import.meta.env.VITE_APP_ENV as string | undefined) || 'pilot') === 'demo' ? 'demo' : 'pilot';
  return { supabaseUrl: url.replace(/\/$/, ''), supabaseAnonKey: key, environment: env };
}

export const config = read();

export function isConfigured(): boolean {
  return /^https?:\/\//.test(config.supabaseUrl) && !config.supabaseUrl.includes('YOUR-PROJECT') && config.supabaseAnonKey.length > 20;
}
