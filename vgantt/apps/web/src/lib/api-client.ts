/**
 * One place that talks to the API.
 *
 * Two behaviours matter beyond plain fetch:
 *   - 401 triggers a single refresh-and-retry, so an expired access token is
 *     invisible to the user rather than a surprise logout;
 *   - 402 MODULE_NOT_LICENSED is surfaced as a typed error, because "your
 *     company has not licensed this module" is a different conversation from
 *     "you lack permission" and the UI says so differently.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    const body = payload as { message?: string; error?: string };
    super(body?.message ?? `İstek başarısız (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error;
    this.payload = payload;
  }

  get isModuleNotLicensed(): boolean {
    return this.status === 402 && this.code === 'MODULE_NOT_LICENSED';
  }

  get isSubscriptionInactive(): boolean {
    return this.code === 'SUBSCRIPTION_INACTIVE';
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

interface TokenStore {
  accessToken: string | null;
  refreshToken: string | null;
  set(tokens: { accessToken: string; refreshToken: string }): void;
  clear(): void;
}

const STORAGE_KEY = 'vgantt.tokens';

export const tokens: TokenStore = {
  accessToken: readStored()?.accessToken ?? null,
  refreshToken: readStored()?.refreshToken ?? null,

  set(next) {
    this.accessToken = next.accessToken;
    this.refreshToken = next.refreshToken;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode / storage disabled: tokens live in memory for this tab.
    }
  },

  clear() {
    this.accessToken = null;
    this.refreshToken = null;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

function readStored(): { accessToken: string; refreshToken: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (!tokens.refreshToken) return false;

  // Concurrent 401s must not each fire their own refresh; the rotation would
  // invalidate the others.
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!response.ok) return false;

      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      tokens.set(data);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const send = async (): Promise<Response> =>
    fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(tokens.accessToken ? { authorization: `Bearer ${tokens.accessToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

  let response = await send();

  if (response.status === 401 && tokens.refreshToken) {
    if (await refreshTokens()) {
      response = await send();
    } else {
      tokens.clear();
    }
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload);

  return payload as T;
}
