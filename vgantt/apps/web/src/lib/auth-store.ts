import { create } from 'zustand';
import { api, tokens, ApiError } from './api-client';
import type { AdminSession, TenantSession } from './types';

interface AuthState {
  session: TenantSession | null;
  adminSession: AdminSession | null;
  status: 'idle' | 'loading' | 'ready';
  error: string | null;

  login(email: string, password: string, tenantSlug?: string): Promise<void>;
  loginAdmin(email: string, password: string): Promise<void>;
  restore(): Promise<void>;
  logout(): Promise<void>;

  can(permission: string): boolean;
  hasModule(moduleKey: string): boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  adminSession: null,
  status: 'idle',
  error: null,

  async login(email, password, tenantSlug) {
    set({ status: 'loading', error: null });
    try {
      const result = await api<{ accessToken: string; refreshToken: string; session: TenantSession }>(
        '/auth/login',
        { method: 'POST', body: { email, password, tenantSlug } },
      );
      tokens.set(result);
      set({ session: result.session, adminSession: null, status: 'ready' });
    } catch (error) {
      set({ status: 'ready', error: describe(error) });
      throw error;
    }
  },

  async loginAdmin(email, password) {
    set({ status: 'loading', error: null });
    try {
      const result = await api<{ accessToken: string; refreshToken: string; session: AdminSession }>(
        '/auth/admin/login',
        { method: 'POST', body: { email, password } },
      );
      tokens.set(result);
      set({ adminSession: result.session, session: null, status: 'ready' });
    } catch (error) {
      set({ status: 'ready', error: describe(error) });
      throw error;
    }
  },

  /** Called once on boot: a stored token means we can skip the login screen. */
  async restore() {
    if (!tokens.accessToken) {
      set({ status: 'ready' });
      return;
    }
    set({ status: 'loading' });
    try {
      const session = await api<TenantSession>('/auth/me');
      set({ session, status: 'ready' });
    } catch {
      tokens.clear();
      set({ session: null, adminSession: null, status: 'ready' });
    }
  },

  async logout() {
    const refreshToken = tokens.refreshToken;
    tokens.clear();
    set({ session: null, adminSession: null });
    if (refreshToken) {
      await api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
    }
  },

  can(permission) {
    return get().session?.permissions.includes(permission) ?? false;
  },

  /**
   * Mirrors the server: a module the tenant has not licensed simply is not in
   * the session, so the menu, the routes and the API all agree.
   */
  hasModule(moduleKey) {
    return get().session?.enabledModules.includes(moduleKey) ?? false;
  },
}));

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isSubscriptionInactive) {
      return 'Şirketinizin aboneliği aktif değil. Lütfen Vgantt ile iletişime geçin.';
    }
    if (error.code === 'TENANT_REQUIRED') {
      return 'Bu e-posta birden fazla şirkette kayıtlı. Lütfen şirket kodunu girin.';
    }
    return error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}
