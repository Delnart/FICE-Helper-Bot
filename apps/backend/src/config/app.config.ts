import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.BACKEND_PORT ?? '3001', 10),
  publicWebAppUrl: process.env.PUBLIC_WEB_APP_URL ?? '',
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },
  campus: {
    baseUrl: process.env.CAMPUS_API_BASE ?? 'https://api.campus.kpi.ua',
    clientId: process.env.CAMPUS_CLIENT_ID ?? '',
    clientSecret: process.env.CAMPUS_CLIENT_SECRET ?? '',
  },
  sheets: {
    id: process.env.GOOGLE_SHEETS_ID ?? '',
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
    privateKey: (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  },
}));
