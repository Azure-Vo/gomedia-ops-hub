// Shared request context and data loaders.
import type { SupabaseClient } from '@supabase/supabase-js';
import { BandLevel, BandRule, DEFAULT_CALENDAR, WorkCalendar, isWorkingTime } from '../../../src/domain/index';
import type { Env } from './env';
import { ApiError, must } from './http';
import { Notifier } from './notify';
import type { TelegramApi } from './telegram';

export interface Ctx {
  env: Env;
  db: SupabaseClient;
  tg: TelegramApi | null;
  notifier: Notifier;
  now: () => number;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: 'account' | 'pm' | 'ceo' | 'ecom_exec' | 'staff' | 'admin';
  active: boolean;
  telegram_chat_id: number | null;
  tg_state: TgState | null;
}

export type TgState =
  | { await: 'reason'; task_id: string; checkpoint_id: number | null; token?: string; message_id?: number; until: number }
  | { await: 'evidence'; task_id: string; milestone_idx: number; until: number };

export interface SettingsRow {
  timezone: string;
  work_days: number[];
  work_blocks: { start: string; end: string }[];
  holidays: string[];
  no_reply_window_hours: number;
  quote_late_hours: number;
  company_name: string;
  telegram_bot_username: string | null;
  app_url: string | null;
  system_status: Record<string, unknown>;
}

export async function loadSettings(db: SupabaseClient): Promise<SettingsRow> {
  const row = must(await db.from('settings').select('*').eq('id', 1).maybeSingle(), 'load settings') as SettingsRow | null;
  if (!row) throw new Error('settings row missing: run 01_schema.sql');
  return { ...row, no_reply_window_hours: Number(row.no_reply_window_hours), quote_late_hours: Number(row.quote_late_hours) };
}

export function calendarOf(s: SettingsRow): WorkCalendar {
  return {
    timeZone: s.timezone || DEFAULT_CALENDAR.timeZone,
    workDays: s.work_days?.length ? s.work_days : DEFAULT_CALENDAR.workDays,
    blocks: s.work_blocks?.length ? s.work_blocks : DEFAULT_CALENDAR.blocks,
    holidays: (s.holidays ?? []).map(String),
  };
}

export async function loadRules(db: SupabaseClient): Promise<BandRule[]> {
  const rows = must(await db.from('price_rules').select('level, max_discount_pct, max_deviation_pct, margin_floor_pct'), 'load price rules') as {
    level: BandLevel;
    max_discount_pct: number | null;
    max_deviation_pct: number | null;
    margin_floor_pct: number | null;
  }[];
  const num = (v: number | null) => (v === null || v === undefined ? null : Number(v));
  return rows.map((r) => ({ level: r.level, maxDiscountPct: num(r.max_discount_pct), maxDeviationPct: num(r.max_deviation_pct), marginFloorPct: num(r.margin_floor_pct) }));
}

export async function loadProfile(db: SupabaseClient, id: string): Promise<Profile | null> {
  return must(
    await db.from('profiles').select('id, email, full_name, role, active, telegram_chat_id, tg_state').eq('id', id).maybeSingle(),
    'load profile',
  ) as Profile | null;
}

export async function profileByChat(db: SupabaseClient, chatId: number): Promise<Profile | null> {
  return must(
    await db.from('profiles').select('id, email, full_name, role, active, telegram_chat_id, tg_state').eq('telegram_chat_id', chatId).maybeSingle(),
    'load profile by chat',
  ) as Profile | null;
}

export function requireRole(p: Profile, ...roles: Profile['role'][]): void {
  if (!roles.includes(p.role)) throw new ApiError(403, 'forbidden', 'Bạn không có quyền làm thao tác này.');
}

export async function logEvent(db: SupabaseClient, actor: string | null, entity: string, entityId: string | null, action: string, payload: unknown = {}) {
  await db.from('events').insert({ actor, entity, entity_id: entityId, action, payload });
}

export async function canMessageNow(ctx: Ctx): Promise<boolean> {
  const s = await loadSettings(ctx.db);
  return isWorkingTime(ctx.now(), calendarOf(s));
}

export function appLink(s: SettingsRow, path: string): string | null {
  if (!s.app_url) return null;
  return `${s.app_url.replace(/\/$/, '')}${path}`;
}
