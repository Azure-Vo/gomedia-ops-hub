import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_CALENDAR, WorkCalendar } from '@/domain';
import { check, supabase } from './supabase';

export interface SettingsRow {
  timezone: string;
  work_days: number[];
  work_blocks: { start: string; end: string }[];
  holidays: string[];
  no_reply_window_hours: number;
  quote_late_hours: number;
  library_review_months: number;
  kpi_baselines: { quote_avg_hours: number; quote_late_pct: number; quote_count: number; task_overdue_pct: number };
  kpi_targets: { quote_avg_hours: number; quote_late_pct: number; response_rate: number; early_warning: number; overdue_pct: number };
  pilot_start: string | null;
  pilot_end: string | null;
  company_name: string;
  telegram_bot_username: string | null;
  app_url: string | null;
  system_status: Record<string, { at?: string } & Record<string, unknown>>;
  updated_at: string;
}

interface SettingsState {
  settings: SettingsRow | null;
  calendar: WorkCalendar;
  tz: string;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<SettingsState | null>(null);

export function calendarFromSettings(s: SettingsRow | null): WorkCalendar {
  if (!s) return DEFAULT_CALENDAR;
  return {
    timeZone: s.timezone || DEFAULT_CALENDAR.timeZone,
    workDays: s.work_days?.length ? s.work_days : DEFAULT_CALENDAR.workDays,
    blocks: s.work_blocks?.length ? s.work_blocks : DEFAULT_CALENDAR.blocks,
    holidays: (s.holidays ?? []).map(String),
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const row = check(await supabase.from('settings').select('*').eq('id', 1).maybeSingle()) as SettingsRow | null;
      if (row) {
        row.no_reply_window_hours = Number(row.no_reply_window_hours);
        row.quote_late_hours = Number(row.quote_late_hours);
      }
      setSettings(row);
      setError(row ? null : 'Chưa có bảng settings: hãy chạy file 01_schema.sql.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo<SettingsState>(() => {
    const calendar = calendarFromSettings(settings);
    return { settings, calendar, tz: calendar.timeZone, loading, error, reload };
  }, [settings, loading, error, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings outside SettingsProvider');
  return v;
}
