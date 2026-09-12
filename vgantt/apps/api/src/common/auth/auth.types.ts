export type Audience = 'tenant' | 'platform';

export interface JwtPayload {
  /** user id (app.users.id) or admin user id (platform.admin_users.id) */
  sub: string;
  /** audience: tenant member vs VganttAdmin operator */
  aud: Audience;
  /** tenant id - present for aud = 'tenant' only */
  tid?: string;
  /** operator role - present for aud = 'platform' only */
  role?: string;
  iat?: number;
  exp?: number;
}

export interface TenantSession {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  email: string;
  fullName: string;
  permissions: string[];
  enabledModules: string[];
  roles: string[];
  subscription: {
    status: string;
    endsOn: string | null;
    daysRemaining: number | null;
  } | null;
}

export interface AdminSession {
  adminUserId: string;
  email: string;
  fullName: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
