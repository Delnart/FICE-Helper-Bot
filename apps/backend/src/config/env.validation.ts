const REQUIRED_KEYS = [
  'MONGO_URI',
  'JWT_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
];

export function validateEnv(config: Record<string, string | undefined>): Record<string, string> {
  for (const key of REQUIRED_KEYS) {
    if (!config[key] || config[key]?.length === 0) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }
  if ((config.JWT_SECRET ?? '').length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
  return config as Record<string, string>;
}
