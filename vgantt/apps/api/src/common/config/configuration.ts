/**
 * Typed configuration, loaded once at boot.
 *
 * Anything that differs between environments lives here; nothing else in the
 * codebase reads process.env directly.
 */
export interface DbPoolConfig {
  user: string;
  password: string;
  max: number;
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  db: {
    host: string;
    port: number;
    database: string;
    ssl: boolean;
    /** Tenant traffic. Role has NO bypassrls: row level security always applies. */
    app: DbPoolConfig;
    /** VganttAdmin control plane. Role has bypassrls; reachable from admin routes only. */
    platform: DbPoolConfig;
  };
  auth: {
    jwtSecret: string;
    accessTtl: string;
    refreshTtl: string;
    passwordMinLength: number;
  };
  alerts: {
    enabled: boolean;
    cron: string;
    mailFrom: string;
    mailTransport: 'console' | 'smtp' | 'webhook';
    smtpUrl?: string;
    webhookUrl?: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be a number, got "${raw}"`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export function loadConfiguration(): AppConfig {
  const env = (process.env.NODE_ENV ?? 'development') as AppConfig['env'];
  const jwtSecret = required('JWT_SECRET');

  if (env === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }

  return {
    env,
    port: num('PORT', 3000),
    apiPrefix: process.env.API_PREFIX ?? 'api',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    db: {
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: num('DB_PORT', 5432),
      database: process.env.DB_NAME ?? 'vgantt',
      ssl: bool('DB_SSL', false),
      app: {
        user: process.env.DB_APP_USER ?? 'vgantt_api',
        password: required('DB_APP_PASSWORD'),
        max: num('DB_APP_POOL_MAX', 20),
      },
      platform: {
        user: process.env.DB_PLATFORM_USER ?? 'vgantt_platform_api',
        password: required('DB_PLATFORM_PASSWORD'),
        max: num('DB_PLATFORM_POOL_MAX', 5),
      },
    },
    auth: {
      jwtSecret,
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
      passwordMinLength: num('PASSWORD_MIN_LENGTH', 10),
    },
    alerts: {
      enabled: bool('ALERTS_ENABLED', true),
      cron: process.env.ALERTS_CRON ?? '0 6 * * *',
      mailFrom: process.env.MAIL_FROM ?? 'bildirim@vgantt.local',
      mailTransport: (process.env.MAIL_TRANSPORT ?? 'console') as AppConfig['alerts']['mailTransport'],
      smtpUrl: process.env.MAIL_SMTP_URL || undefined,
      webhookUrl: process.env.ALERT_WEBHOOK_URL || undefined,
    },
  };
}
