// Notification module: the single place that talks to a messaging channel.
// The pilot uses Telegram. To switch to Go Media's internal bot, implement Channel for it
// and return it from makeChannel(); nothing else in the app changes.
import type { SupabaseClient } from '@supabase/supabase-js';
import { TelegramApi } from './telegram';

export interface Button {
  text: string;
  data?: string; // callback payload (≤ 64 bytes on Telegram)
  url?: string;
}

export interface DeliveryResult {
  delivered: boolean;
  messageId?: number;
  /** The address no longer works (user blocked the bot, chat deleted): unlink it. */
  permanent?: boolean;
  reason?: string;
}

export interface Channel {
  name: 'telegram' | string;
  deliver(address: number, text: string, buttons?: Button[][]): Promise<DeliveryResult>;
}

export function telegramChannel(api: TelegramApi): Channel {
  return {
    name: 'telegram',
    async deliver(chatId, text, buttons) {
      const keyboard = buttons?.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? '' })));
      const res = await api.sendMessage(chatId, text, keyboard);
      if (res.ok) return { delivered: true, messageId: res.result?.message_id };
      const permanent = res.error_code === 403 || (res.error_code === 400 && /chat not found|user is deactivated/i.test(res.description ?? ''));
      return { delivered: false, permanent, reason: res.description };
    },
  };
}

export function makeChannel(api: TelegramApi | null): Channel | null {
  return api ? telegramChannel(api) : null;
}

export class Notifier {
  constructor(
    private db: SupabaseClient,
    private channel: Channel | null,
  ) {}

  get enabled(): boolean {
    return this.channel !== null;
  }

  /** send(userId, text, buttons): delivers to the user's linked chat; false when not linked. */
  async send(userId: string, text: string, buttons?: Button[][]): Promise<DeliveryResult> {
    if (!this.channel) return { delivered: false, reason: 'no_channel' };
    const { data } = await this.db.from('profiles').select('telegram_chat_id, active').eq('id', userId).maybeSingle();
    const chatId = data?.telegram_chat_id as number | null | undefined;
    if (!chatId || data?.active === false) return { delivered: false, reason: 'not_linked' };
    const res = await this.channel.deliver(Number(chatId), text, buttons);
    if (!res.delivered && res.permanent) {
      await this.db.from('profiles').update({ telegram_chat_id: null }).eq('id', userId);
    }
    return res;
  }

  /** Sends to every active user with one of the roles; returns how many received it. */
  async sendToRoles(roles: string[], text: string, buttons?: Button[][]): Promise<number> {
    const { data } = await this.db.from('profiles').select('id').in('role', roles).eq('active', true);
    let n = 0;
    for (const p of data ?? []) if ((await this.send(p.id as string, text, buttons)).delivered) n++;
    return n;
  }
}
