import { createClient } from '@supabase/supabase-js';
import { config } from './config';

export const supabase = createClient(config.supabaseUrl || 'http://invalid.local', config.supabaseAnonKey || 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
    storageKey: `ops-hub-auth-${config.environment}`,
  },
});

/** Throws a readable error when a query failed; otherwise returns its data. */
export function check<T>(res: { data: T | null; error: { message: string; code?: string; details?: string } | null }): T {
  if (res.error) {
    const m = res.error.message || 'Lỗi không rõ';
    if (/permission denied|row-level security/i.test(m)) throw new Error('Bạn không có quyền với dữ liệu này.');
    if (/Failed to fetch|NetworkError/i.test(m)) throw new Error('Mất kết nối mạng. Kiểm tra Internet rồi thử lại.');
    throw new Error(m);
  }
  return res.data as T;
}
