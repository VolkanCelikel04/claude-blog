import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PLATFORM_ROLES_KEY } from './permissions.decorator';
import { RequestContextStore } from '../context/request-context';

/**
 * Checks the permission set that was resolved at authentication time.
 *
 * The set comes from app.v_user_permissions, which already drops permissions
 * belonging to modules the tenant does not license - so a user whose role
 * grants finance.invoice.write loses it the moment VganttAdmin switches the
 * finance module off, with no extra bookkeeping.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const adminRoles = this.reflector.getAllAndOverride<string[] | undefined>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const ctx = RequestContextStore.get();
    if (!ctx) throw new ForbiddenException('No request context');

    if (adminRoles?.length) {
      if (!ctx.adminRole) {
        throw new ForbiddenException('Bu işlem yalnızca VganttAdmin kullanıcıları içindir.');
      }
      if (ctx.adminRole !== 'super_admin' && !adminRoles.includes(ctx.adminRole)) {
        throw new ForbiddenException(`Gerekli operatör rolü: ${adminRoles.join(', ')}`);
      }
    }

    if (!required?.length) return true;

    const missing = required.filter((permission) => !ctx.permissions.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(`Eksik yetki: ${missing.join(', ')}`);
    }

    return true;
  }
}
