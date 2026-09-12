import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PlatformDb } from '../database/platform-db.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { AppConfig } from '../config/configuration';
import { AdminSession, AuthTokens, JwtPayload, TenantSession } from './auth.types';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

interface UserLookupRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  locked_until: Date | null;
  failed_attempts: number;
  tenant_status: string;
  tenant_slug: string;
  has_live_subscription: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly platformDb: PlatformDb,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- tenant
  async loginTenantUser(
    email: string,
    password: string,
    tenantSlug: string | undefined,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ tokens: AuthTokens; session: TenantSession }> {
    // Pre-authentication lookup: there is no tenant context yet, so this runs
    // on the platform pool. It is the one place that reads across tenants.
    const candidates = await this.platformDb.query<UserLookupRow>(
      `SELECT u.id, u.tenant_id, u.email::text AS email, u.password_hash, u.is_active,
              u.locked_until, u.failed_attempts,
              t.status::text AS tenant_status, t.slug::text AS tenant_slug,
              EXISTS (SELECT 1 FROM platform.subscriptions s
                       WHERE s.tenant_id = t.id
                         AND s.status IN ('trial','active','past_due')
                         AND s.ends_on >= current_date) AS has_live_subscription
         FROM app.users u
         JOIN platform.tenants t ON t.id = u.tenant_id
        WHERE u.email = $1
          AND ($2::citext IS NULL OR t.slug = $2::citext)`,
      [email, tenantSlug ?? null],
    );

    if (candidates.length === 0) {
      // Same error and roughly the same cost as a wrong password: no e-mail
      // enumeration through timing or message differences.
      await this.passwords.verify('$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password);
      throw new UnauthorizedException('E-posta veya şifre hatalı.');
    }

    if (candidates.length > 1) {
      throw new BadRequestException({
        error: 'TENANT_REQUIRED',
        message: 'Bu e-posta birden fazla şirkette kayıtlı. Lütfen şirket kodunu belirtin.',
        tenants: candidates.map((c) => c.tenant_slug),
      });
    }

    const user = candidates[0];

    if (user.locked_until && user.locked_until > new Date()) {
      throw new ForbiddenException(
        `Hesap geçici olarak kilitli. ${LOCKOUT_MINUTES} dakika sonra tekrar deneyin.`,
      );
    }
    if (!user.is_active) {
      throw new ForbiddenException('Kullanıcı hesabı pasif durumda.');
    }

    const ok = await this.passwords.verify(user.password_hash, password);
    if (!ok) {
      await this.registerFailedAttempt(user.id, user.failed_attempts);
      throw new UnauthorizedException('E-posta veya şifre hatalı.');
    }

    this.assertTenantUsable(user);

    if (this.passwords.needsRehash(user.password_hash)) {
      const upgraded = await this.passwords.hash(password);
      await this.platformDb.execute('UPDATE app.users SET password_hash = $2 WHERE id = $1', [
        user.id,
        upgraded,
      ]);
    }

    await this.platformDb.execute(
      `UPDATE app.users
          SET last_login_at = now(), failed_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [user.id],
    );

    this.sessions.invalidateUser(user.id);
    const session = await this.sessions.loadTenantSession(user.id);
    if (!session) throw new UnauthorizedException('Oturum oluşturulamadı.');

    const tokens = await this.issueTokens(
      { sub: user.id, aud: 'tenant', tid: user.tenant_id },
      user.tenant_id,
      user.id,
      meta,
    );

    await this.audit(user.tenant_id, user.id, 'auth.login', meta);
    return { tokens, session };
  }

  private assertTenantUsable(user: UserLookupRow): void {
    if (user.tenant_status === 'cancelled') {
      throw new ForbiddenException('Şirket hesabı kapatılmıştır.');
    }
    if (user.tenant_status === 'suspended' || !user.has_live_subscription) {
      throw new ForbiddenException({
        error: 'SUBSCRIPTION_INACTIVE',
        message:
          'Şirketinizin aboneliği sona ermiş görünüyor. Lütfen yöneticinizle veya Vgantt ile iletişime geçin.',
      });
    }
  }

  private async registerFailedAttempt(userId: string, current: number): Promise<void> {
    const next = current + 1;
    await this.platformDb.execute(
      `UPDATE app.users
          SET failed_attempts = $2,
              locked_until = CASE WHEN $2 >= $3 THEN now() + ($4 || ' minutes')::interval ELSE NULL END
        WHERE id = $1`,
      [userId, next, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MINUTES)],
    );
  }

  // ----------------------------------------------------------- VganttAdmin
  async loginAdmin(
    email: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ tokens: AuthTokens; session: AdminSession }> {
    const admin = await this.platformDb.one<{
      id: string;
      email: string;
      full_name: string;
      password_hash: string;
      role: string;
      is_active: boolean;
      locked_until: Date | null;
      failed_attempts: number;
    }>(
      `SELECT id, email::text AS email, full_name, password_hash, role::text AS role,
              is_active, locked_until, failed_attempts
         FROM platform.admin_users WHERE email = $1`,
      [email],
    );

    if (!admin || !admin.is_active) {
      throw new UnauthorizedException('E-posta veya şifre hatalı.');
    }
    if (admin.locked_until && admin.locked_until > new Date()) {
      throw new ForbiddenException('Hesap geçici olarak kilitli.');
    }

    const ok = await this.passwords.verify(admin.password_hash, password);
    if (!ok) {
      await this.platformDb.execute(
        `UPDATE platform.admin_users
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE WHEN failed_attempts + 1 >= $2
                                    THEN now() + ($3 || ' minutes')::interval END
          WHERE id = $1`,
        [admin.id, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MINUTES)],
      );
      throw new UnauthorizedException('E-posta veya şifre hatalı.');
    }

    if (this.passwords.needsRehash(admin.password_hash)) {
      const upgraded = await this.passwords.hash(password);
      await this.platformDb.execute(
        'UPDATE platform.admin_users SET password_hash = $2 WHERE id = $1',
        [admin.id, upgraded],
      );
    }

    await this.platformDb.execute(
      `UPDATE platform.admin_users
          SET last_login_at = now(), failed_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [admin.id],
    );

    const tokens = await this.issueTokens(
      { sub: admin.id, aud: 'platform', role: admin.role },
      null,
      null,
      meta,
    );

    await this.platformDb.execute(
      `INSERT INTO audit.activity_log (actor_type, actor_id, actor_label, action, ip_address, user_agent)
       VALUES ('platform_admin', $1, $2, 'auth.admin_login', $3, $4)`,
      [admin.id, admin.email, meta.ip ?? null, meta.userAgent ?? null],
    );

    return {
      tokens,
      session: {
        adminUserId: admin.id,
        email: admin.email,
        fullName: admin.full_name,
        role: admin.role,
      },
    };
  }

  // --------------------------------------------------------------- tokens
  private async issueTokens(
    payload: JwtPayload,
    tenantId: string | null,
    userId: string | null,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthTokens> {
    const auth = this.config.getOrThrow<AppConfig['auth']>('auth');

    const accessToken = await this.jwt.signAsync(payload, { expiresIn: auth.accessTtl });
    const refreshToken = randomBytes(48).toString('base64url');

    // Only the digest is stored: a database leak does not hand out sessions.
    if (tenantId && userId) {
      await this.platformDb.execute(
        `INSERT INTO app.refresh_tokens (tenant_id, user_id, token_hash, expires_at, user_agent, ip_address)
         VALUES ($1, $2, $3, now() + $4::interval, $5, $6)`,
        [
          tenantId,
          userId,
          this.digest(refreshToken),
          this.intervalFromTtl(auth.refreshTtl),
          meta.userAgent ?? null,
          meta.ip ?? null,
        ],
      );
    }

    return { accessToken, refreshToken, expiresIn: this.secondsFromTtl(auth.accessTtl) };
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }): Promise<AuthTokens> {
    const row = await this.platformDb.one<{ id: string; user_id: string; tenant_id: string }>(
      `SELECT id, user_id, tenant_id
         FROM app.refresh_tokens
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [this.digest(refreshToken)],
    );

    if (!row) throw new UnauthorizedException('Oturum süresi doldu, lütfen tekrar giriş yapın.');

    const tokens = await this.issueTokens(
      { sub: row.user_id, aud: 'tenant', tid: row.tenant_id },
      row.tenant_id,
      row.user_id,
      meta,
    );

    // Rotation: the presented token is burned immediately.
    await this.platformDb.execute(
      `UPDATE app.refresh_tokens SET revoked_at = now() WHERE id = $1`,
      [row.id],
    );

    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.platformDb.execute(
      `UPDATE app.refresh_tokens SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [this.digest(refreshToken)],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.platformDb.execute(
      `UPDATE app.refresh_tokens SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    this.sessions.invalidateUser(userId);
  }

  private digest(token: string): Buffer {
    return createHash('sha256').update(token).digest();
  }

  private intervalFromTtl(ttl: string): string {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return '30 days';
    const unit = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' }[match[2]];
    return `${match[1]} ${unit}`;
  }

  private secondsFromTtl(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const factor = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 60;
    return Number(match[1]) * factor;
  }

  private async audit(
    tenantId: string,
    userId: string,
    action: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<void> {
    await this.platformDb.execute(
      `INSERT INTO audit.activity_log (actor_type, actor_id, tenant_id, action, ip_address, user_agent)
       VALUES ('tenant_user', $1, $2, $3, $4, $5)`,
      [userId, tenantId, action, meta.ip ?? null, meta.userAgent ?? null],
    );
  }
}
