import { createHmac } from 'crypto';

export interface ParsedTelegramInitData {
  user?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    language_code?: string;
  };
  auth_date: number;
  hash: string;
  start_param?: string;
  query_id?: string;
  chat_type?: string;
  chat_instance?: string;
}

export function verifyAndParseInitData(
  initDataRaw: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60,
): ParsedTelegramInitData {
  if (!initDataRaw) throw new Error('Empty initData');

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) throw new Error('Missing hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computed, hash)) {
    throw new Error('Invalid Telegram init data signature');
  }

  const authDateStr = params.get('auth_date');
  if (!authDateStr) throw new Error('Missing auth_date');
  const authDate = parseInt(authDateStr, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Number.isNaN(authDate) || nowSec - authDate > maxAgeSeconds) {
    throw new Error('Telegram init data expired');
  }

  const userRaw = params.get('user');
  const parsed: ParsedTelegramInitData = {
    auth_date: authDate,
    hash,
    user: userRaw ? JSON.parse(userRaw) : undefined,
    start_param: params.get('start_param') ?? undefined,
    query_id: params.get('query_id') ?? undefined,
    chat_type: params.get('chat_type') ?? undefined,
    chat_instance: params.get('chat_instance') ?? undefined,
  };

  return parsed;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
