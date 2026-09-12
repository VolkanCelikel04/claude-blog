import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'vgantt:permissions';

/**
 * Requires ALL listed permissions.
 *
 *   @RequirePermissions('finance.invoice.write')
 *   @Post()
 *   create(...) {}
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const PLATFORM_ROLES_KEY = 'vgantt:platform-roles';

/** Restricts a VganttAdmin route to specific operator roles. */
export const RequireAdminRole = (...roles: string[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);
