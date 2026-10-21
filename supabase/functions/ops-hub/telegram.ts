// Telegram Bot API client (only the calls the pilot needs).

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export class TelegramApi {
  constructor(
    private token: string,
    private base = 'https://api.telegram.org',
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<TgResult<T>> {
    try {
      const res = await this.fetchImpl(`${this.base}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResult<T>;
      if (!data.ok && data.error_code === undefined) data.error_code = res.status;
      return data;
    } catch (err) {
      return { ok: false, description: (err as Error).message, error_code: 0 };
    }
  }

  sendMessage(chatId: number, text: string, keyboard?: InlineButton[][], extra: Record<string, unknown> = {}) {
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      ...extra,
    });
  }

  askForReply(chatId: number, text: string, placeholder: string) {
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { force_reply: true, input_field_placeholder: placeholder },
    });
  }

  clearButtons(chatId: number, messageId: number) {
    return this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }

  answerCallback(id: string, text: string) {
    return this.call('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 190) });
  }

  getMe() {
    return this.call<{ id: number; username: string; first_name: string }>('getMe');
  }

  getWebhookInfo() {
    return this.call<{ url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string }>('getWebhookInfo');
  }

  setWebhook(url: string, secretToken: string) {
    return this.call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
      max_connections: 10,
    });
  }
}

/** Webhook secret derived from the bot token (HMAC-SHA256), so only one secret has to be set. */
export async function deriveWebhookSecret(botToken: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(botToken), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('go-media-ops-hub/telegram-webhook'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
