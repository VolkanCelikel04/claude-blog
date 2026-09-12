import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AUDIENCE_KEY, IS_PUBLIC_KEY } from './decorators';
import { Audience, JwtPayload } from './auth.types';
import { SessionService } from './session.service';
import { PlatformDb } from '../database/platform-db.service';
import { RequestContextStore } from '../context/request-context';

/**
 * Verifies the bearer token and fills the request context.
 *
 * Tenant and VganttAdmin tokens carry different audiences and are never
 * interchangeable: a tenant token on an admin route is rejected before the
 * handler, and the admin connection pool is unreachable from tenant routes.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly platformDb: PlatformDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Kimlik doğrulama gerekli.');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Oturum geçersiz veya süresi dolmuş.');
    }

    const requiredAudience =
      this.reflector.getAllAndOverride<Audience | undefined>(AUDIENCE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'tenant';

    if (payload.aud !== requiredAudience) {
      throw new ForbiddenException('Bu uç nokta için geçersiz oturum türü.');
    }

    const ctx = RequestContextStore.get();
    if (!ctx) throw new UnauthorizedException('Request context missing');

    if (payload.aud === 'platform') {
      const admin = await this.platformDb.one<{ id: string; role: string; is_active: boolean }>(
        `SELECT id, role::text AS role, is_active FROM platform.admin_users WHERE id = $1`,
        [payload.sub],
      );
      if (!admin?.is_active) throw new UnauthorizedException('Operatör hesabı pasif.');

      ctx.adminUserId = admin.id;
      ctx.adminRole = admin.role;
      return true;
    }

    const session = await this.sessions.loadTenantSession(payload.sub);
    if (!session) throw new UnauthorizedException('Kullanıcı bulunamadı veya pasif.');
    if (payload.tid && payload.tid !== session.tenantId) {
      // Token says one tenant, the user belongs to another: refuse rather than
      // silently trusting either side.
      throw new ForbiddenException('Oturum ile şirket bilgisi uyuşmuyor.');
    }

    ctx.tenantId = session.tenantId;
    ctx.tenantSlug = session.tenantSlug;
    ctx.userId = session.userId;
    ctx.permissions = new Set(session.permissions);
    ctx.enabledModules = new Set(session.enabledModules);

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' ? value : undefined;
  }
}
