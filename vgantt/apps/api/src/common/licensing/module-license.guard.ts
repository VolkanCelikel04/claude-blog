import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_MODULE_KEY } from './requires-module.decorator';
import { ModuleKey, MODULE_REGISTRY } from './module-registry';
import { LicensingService } from './licensing.service';
import { RequestContextStore } from '../context/request-context';

@Injectable()
export class ModuleLicenseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licensing: LicensingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRES_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    const ctx = RequestContextStore.get();
    if (!ctx?.tenantId) {
      throw new HttpException('Tenant context required', HttpStatus.UNAUTHORIZED);
    }

    if (await this.licensing.isEnabled(ctx.tenantId, required)) {
      return true;
    }

    // 402 rather than 403: the request is well-formed and the user is allowed,
    // the tenant simply has not licensed this module. The frontend uses the
    // distinction to show "modül kapalı" instead of "yetkiniz yok".
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'MODULE_NOT_LICENSED',
        moduleKey: required,
        moduleName: MODULE_REGISTRY[required].name,
        message: `"${MODULE_REGISTRY[required].name}" modülü şirketiniz için etkin değil. Lütfen yöneticinizle iletişime geçin.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
