// HTTP helpers shared by every route.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Preflight answer that allows whatever headers this supabase-js version sends. */
export function preflight(req: Request): Response {
  const asked = req.headers.get('access-control-request-headers');
  return new Response('ok', { headers: { ...CORS_HEADERS, ...(asked ? { 'Access-Control-Allow-Headers': asked } : {}) } });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export function fail(err: unknown): Response {
  if (err instanceof ApiError) return json({ error: { code: err.code, message: err.message } }, err.status);
  const message = err instanceof Error ? err.message : String(err);
  console.error('ops-hub error', message, err instanceof Error ? err.stack : '');
  return json({ error: { code: 'server_error', message: `Lỗi máy chủ: ${message}` } }, 500);
}

/** Constant-time comparison for secrets. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function randomToken(bytes = 9): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Raises a readable error when a database call fails. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) {
    const msg = res.error.message || 'unknown';
    if (/conflict|already_answered|checkpoint_expired|task_closed|task_started|checkpoint_not_sent/.test(msg)) {
      throw new ApiError(409, msg.match(/conflict|already_answered|checkpoint_expired|task_closed|task_started|checkpoint_not_sent/)![0], msg);
    }
    throw new Error(`${what}: ${msg}`);
  }
  return res.data as T;
}
