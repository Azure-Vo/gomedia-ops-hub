// Local stand-in for a Supabase project, for automated end-to-end tests only.
//   :54321  API gateway  → /rest/v1 (PostgREST), /auth/v1 (mock GoTrue), /functions/v1/ops-hub (the real function code)
//            plus /telegram/bot<token>/<method> (mock Telegram Bot API) and /__test/* helpers
//   :54340  static web app (dist/) with SPA fallback
// Usage: node tools/local-stack/server.mjs   (Postgres must be running on 127.0.0.1:54322)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomInt } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const PORT = 54321;
const WEB_PORT = 54340;
const PGRST_PORT = 54330;
const PG = { host: '127.0.0.1', port: 54322, user: 'postgres', database: 'postgres' };
const JWT_SECRET = 'local-test-jwt-secret-with-more-than-32-chars';
const key = new TextEncoder().encode(JWT_SECRET);
const BOT_TOKEN = '123456:LOCAL-TEST-TOKEN';
const pool = new pg.Pool(PG);

const sign = (claims, ttl = '1h') => new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setExpirationTime(ttl).sign(key);
export const ANON_KEY = await sign({ role: 'anon', iss: 'supabase-local' }, '10y');
export const SERVICE_KEY = await sign({ role: 'service_role', iss: 'supabase-local' }, '10y');

// ---------------------------------------------------------------- PostgREST -----
const pgrst = spawn(process.env.POSTGREST_BIN ?? '/home/claude/.cache/ops-hub-bin/postgrest', [], {
  env: {
    ...process.env,
    PGRST_DB_URI: `postgres://authenticator:authpass@127.0.0.1:54322/postgres`,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: JWT_SECRET,
    PGRST_SERVER_PORT: String(PGRST_PORT),
    PGRST_DB_POOL: '10',
    PGRST_LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
process.on('exit', () => pgrst.kill());

// ------------------------------------------------------------- mock Telegram ----
const telegram = { calls: [], nextId: 1000, webhook: null };

function telegramMethod(method, body) {
  telegram.calls.push({ method, body, at: Date.now() });
  if (method === 'getMe') return { ok: true, result: { id: 1, is_bot: true, first_name: 'Go Task Bot', username: 'gomedia_local_bot' } };
  if (method === 'setWebhook') {
    telegram.webhook = body.url;
    return { ok: true, result: true };
  }
  if (method === 'getWebhookInfo') return { ok: true, result: { url: telegram.webhook ?? '', pending_update_count: 0 } };
  if (method === 'sendMessage') {
    if (body.chat_id === 403) return { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' };
    return { ok: true, result: { message_id: telegram.nextId++, chat: { id: body.chat_id }, text: body.text } };
  }
  return { ok: true, result: true };
}

// ------------------------------------------------------------------ mock auth ----
const otps = new Map();
const refresh = new Map();

function userJson(u) {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    confirmed_at: u.email_confirmed_at,
    phone: '',
    last_sign_in_at: u.last_sign_in_at,
    app_metadata: { provider: 'email', providers: ['email'], ...(u.raw_app_meta_data ?? {}) },
    user_metadata: u.raw_user_meta_data ?? {},
    identities: [],
    created_at: u.created_at,
    updated_at: u.created_at,
    is_anonymous: false,
  };
}

async function session(u) {
  const access_token = await sign({
    aud: 'authenticated',
    sub: u.id,
    email: u.email,
    phone: '',
    role: 'authenticated',
    app_metadata: userJson(u).app_metadata,
    user_metadata: u.raw_user_meta_data ?? {},
    aal: 'aal1',
    session_id: randomUUID(),
    is_anonymous: false,
  });
  const refresh_token = randomUUID();
  refresh.set(refresh_token, u.id);
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token, user: userJson(u) };
}

async function userFromBearer(req) {
  const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  try {
    const { payload } = await jwtVerify(t, key);
    if (payload.role !== 'authenticated') return null;
    const { rows } = await pool.query('select * from auth.users where id = $1', [payload.sub]);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function isService(req) {
  const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || req.headers.apikey;
  try {
    const { payload } = await jwtVerify(t, key);
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

async function authRoute(req, url, body) {
  const path = url.pathname.replace(/^\/auth\/v1/, '');
  if (path === '/otp' && req.method === 'POST') {
    const email = String(body.email ?? '').toLowerCase();
    const { rows } = await pool.query('select * from auth.users where lower(email) = $1', [email]);
    if (!rows[0] && body.create_user === false) return [422, { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' }];
    const code = String(randomInt(100000, 999999));
    otps.set(email, code);
    return [200, {}];
  }
  if (path === '/verify' && req.method === 'POST') {
    const email = String(body.email ?? '').toLowerCase();
    if (!otps.get(email) || otps.get(email) !== String(body.token)) return [403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }];
    otps.delete(email);
    const { rows } = await pool.query('update auth.users set last_sign_in_at = now() where lower(email) = $1 returning *', [email]);
    return [200, await session(rows[0])];
  }
  if (path === '/user' && req.method === 'GET') {
    const u = await userFromBearer(req);
    return u ? [200, userJson(u)] : [401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }];
  }
  if (path === '/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const uid = refresh.get(body.refresh_token);
    if (!uid) return [400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }];
    refresh.delete(body.refresh_token);
    const { rows } = await pool.query('select * from auth.users where id = $1', [uid]);
    return [200, await session(rows[0])];
  }
  if (path === '/logout') return [204, null];
  if (path === '/admin/users' && req.method === 'POST') {
    if (!(await isService(req))) return [401, { msg: 'service role required' }];
    const email = String(body.email ?? '').toLowerCase();
    const exists = await pool.query('select 1 from auth.users where lower(email) = $1', [email]);
    if (exists.rows.length) return [422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' }];
    const { rows } = await pool.query(
      'insert into auth.users (email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values ($1, $2, $3, now()) returning *',
      [email, JSON.stringify(body.app_metadata ?? {}), JSON.stringify(body.user_metadata ?? {})],
    );
    return [200, userJson(rows[0])];
  }
  const del = path.match(/^\/admin\/users\/([0-9a-f-]+)$/);
  if (del && req.method === 'DELETE') {
    if (!(await isService(req))) return [401, { msg: 'service role required' }];
    const { rows } = await pool.query('delete from auth.users where id = $1 returning *', [del[1]]);
    return [200, rows[0] ? userJson(rows[0]) : {}];
  }
  return [404, { msg: `mock auth: ${req.method} ${path} not implemented` }];
}

// -------------------------------------------------------------- the function ----
const { createHandler } = await import(join(here, '.build', 'handler.mjs'));
const { readEnv } = await import(join(here, '.build', 'env.mjs'));
const fnEnv = {
  SUPABASE_URL: `http://127.0.0.1:${PORT}`,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  TELEGRAM_API_BASE: `http://127.0.0.1:${PORT}/telegram`,
  APP_ENV: process.env.APP_ENV ?? 'demo',
};
const fn = createHandler(readEnv((k) => fnEnv[k]), { allowTestClock: true });

// ------------------------------------------------------------------- gateway ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-supabase-api-version, x-test-now',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'content-range, content-location',
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers });
  res.end(body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'OPTIONS' && !url.pathname.startsWith('/functions/')) {
      return send(res, 204, null, req.headers['access-control-request-headers'] ? { 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] } : {});
    }
    const raw = await readBody(req);
    const json = () => (raw.length ? JSON.parse(raw.toString('utf8')) : {});

    if (url.pathname.startsWith('/rest/v1/')) {
      const headers = { ...req.headers };
      delete headers.host;
      if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
      const upstream = await fetch(`http://127.0.0.1:${PGRST_PORT}${url.pathname.replace('/rest/v1', '')}${url.search}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw,
      });
      const out = Buffer.from(await upstream.arrayBuffer());
      const h = {};
      upstream.headers.forEach((v, k) => {
        if (!['content-length', 'transfer-encoding', 'connection'].includes(k) && !k.startsWith('access-control-')) h[k] = v;
      });
      res.writeHead(upstream.status, { ...h, ...CORS });
      return res.end(out);
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      const [status, body] = await authRoute(req, url, json());
      return send(res, status, body);
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      const r = await fn(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw }));
      const h = {};
      r.headers.forEach((v, k) => (h[k] = v));
      res.writeHead(r.status, h);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const tg = url.pathname.match(/^\/telegram\/bot([^/]+)\/(\w+)$/);
    if (tg) {
      if (tg[1] !== BOT_TOKEN) return send(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
      return send(res, 200, telegramMethod(tg[2], json()));
    }
    if (url.pathname === '/__test/otp') return send(res, 200, { code: otps.get(String(url.searchParams.get('email')).toLowerCase()) ?? null });
    if (url.pathname === '/__test/telegram') {
      if (req.method === 'DELETE') telegram.calls = [];
      return send(res, 200, telegram);
    }
    if (url.pathname === '/__test/keys') return send(res, 200, { anon: ANON_KEY, service: SERVICE_KEY, botToken: BOT_TOKEN });
    if (url.pathname === '/__test/sql' && req.method === 'POST') {
      const { sql, params } = json();
      // No parameters: simple protocol, so a whole setup file (several statements) runs as in the SQL Editor.
      const r = params?.length ? await pool.query(sql, params) : await pool.query(sql);
      const last = Array.isArray(r) ? r[r.length - 1] : r;
      return send(res, 200, { rows: last.rows });
    }
    return send(res, 404, { msg: 'not found' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { msg: String(err?.message ?? err) });
  }
});
server.listen(PORT, '127.0.0.1');

// ---------------------------------------------------------------- static web ----
const webDir = process.env.WEB_DIR ?? join(root, 'dist', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
http
  .createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(webDir, p);
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(`window.OPS_HUB_CONFIG = ${JSON.stringify({ supabaseUrl: `http://127.0.0.1:${PORT}`, supabaseAnonKey: ANON_KEY, environment: process.env.APP_ENV ?? 'demo' })};`);
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(webDir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  })
  .listen(WEB_PORT, '127.0.0.1');

console.log(`local stack ready: api http://127.0.0.1:${PORT}  web http://127.0.0.1:${WEB_PORT}`);
