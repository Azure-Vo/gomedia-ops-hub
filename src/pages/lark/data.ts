import type { BotMessage, LarkCodeRules } from '@/domain';
import { DEFAULT_LARK_CODE_RULES } from '@/domain';
import type { SettingsRow } from '@/lib/settings';

export interface LarkTaskRow {
  id: string;
  kind: 'parent' | 'child';
  parent_id: string | null;
  code: string;
  parent_code: string | null;
  name: string;
  description: string | null;
  assignee_open_id: string | null;
  assignee_name: string | null;
  due_date: string;
  mode: 'simulation' | 'live';
  lark_url: string | null;
  completed_at: string | null;
  closed_at: string | null;
  code_errors: string[];
  source: 'bot' | 'web';
  created_at: string;
}
export const LARK_TASK_COLS =
  'id, kind, parent_id, code, parent_code, name, description, assignee_open_id, assignee_name, due_date, mode, lark_url, completed_at, closed_at, code_errors, source, created_at';

export interface LarkNotificationRow {
  id: string;
  task_id: string;
  local_date: string;
  kind: 'reminder' | 'completion';
  milestone: string | null;
  status: 'sent' | 'simulated' | 'failed';
  attempts: number;
  last_error: string | null;
  message: BotMessage;
  sent_at: string | null;
  created_at: string;
}
export const LARK_NOTIF_COLS = 'id, task_id, local_date, kind, milestone, status, attempts, last_error, message, sent_at, created_at';

export interface LarkPerson {
  open_id: string;
  name: string;
  profile_id: string | null;
}

export function rulesOf(s: SettingsRow | null): LarkCodeRules {
  if (!s) return DEFAULT_LARK_CODE_RULES;
  return {
    parentPattern: s.lark_parent_pattern || DEFAULT_LARK_CODE_RULES.parentPattern,
    childPattern: s.lark_child_pattern || DEFAULT_LARK_CODE_RULES.childPattern,
    parentExample: s.lark_parent_example || DEFAULT_LARK_CODE_RULES.parentExample,
    childExample: s.lark_child_example || DEFAULT_LARK_CODE_RULES.childExample,
  };
}
