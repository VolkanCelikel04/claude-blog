import { SetMetadata } from '@nestjs/common';
import { ModuleKey } from './module-registry';

export const REQUIRES_MODULE_KEY = 'vgantt:requires-module';

/**
 * Marks a controller or handler as belonging to a licensed module.
 *
 *   @RequiresModule('finance')
 *   @Controller('finance/invoices')
 *   export class InvoicesController {}
 *
 * ModuleLicenseGuard rejects the request with 402 when VganttAdmin has the
 * module switched off for the caller's tenant. Row level security blocks the
 * same data independently, so a forgotten decorator leaks nothing - it just
 * produces a worse error message.
 */
export const RequiresModule = (moduleKey: ModuleKey) => SetMetadata(REQUIRES_MODULE_KEY, moduleKey);
