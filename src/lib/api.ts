// Calls the business actions of the Edge Function "ops-hub". Every rule is checked there
// again with the same src/domain code, so the browser cannot bypass a rule.
import { supabase } from './supabase';

export class ApiFailure extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function callApi<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ops-hub/api', { body: { action, ...payload } });
  if (error) {
    let code = 'error';
    let message = 'Không gọi được máy chủ (Edge Function ops-hub). Kiểm tra mạng hoặc trang Diagnostics.';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        code = body?.error?.code ?? code;
        message = body?.error?.message ?? message;
      } catch {
        if (ctx.status === 404) message = 'Chưa có Edge Function "ops-hub" trên Supabase (xem hướng dẫn triển khai, bước 4).';
      }
    }
    throw new ApiFailure(code, message);
  }
  return data as T;
}
