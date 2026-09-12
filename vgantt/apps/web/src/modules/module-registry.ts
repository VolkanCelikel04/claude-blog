import type { ComponentType } from 'react';

/**
 * The frontend half of the module system.
 *
 * A module declares its route, its icon, the permission that opens it and the
 * licence key it needs. The sidebar is rendered from this list filtered by the
 * session, so adding a module never means editing a navigation component - see
 * docs/ADDING-A-MODULE.md step 6.
 */
export interface ModuleRoute {
  path: string;
  label: string;
  component: () => Promise<{ default: ComponentType }>;
  /** Hidden unless the tenant holds this permission. */
  permission?: string;
}

export interface ModuleDescriptor {
  key: string;
  label: string;
  icon: string;
  /** Matches platform.modules.key. Omit for always-available areas. */
  licenseKey?: string;
  permission?: string;
  /** Only reachable inside the Electron shell. */
  desktopOnly?: boolean;
  routes: ModuleRoute[];
}

export const MODULES: ModuleDescriptor[] = [
  {
    key: 'dashboard',
    label: 'Ana Panel',
    icon: 'home',
    permission: 'dashboard.view',
    routes: [
      { path: '/', label: 'Ana Panel', component: () => import('../features/dashboard/DashboardPage') },
    ],
  },
  {
    key: 'licenses',
    label: 'Lisans Takibi',
    icon: 'calendar-clock',
    licenseKey: 'licenses',
    permission: 'licenses.read',
    routes: [
      { path: '/licenses', label: 'Lisans Takibi', component: () => import('../features/licenses/LicensesPage') },
    ],
  },
  {
    key: 'finance',
    label: 'Finans',
    icon: 'wallet',
    licenseKey: 'finance',
    permission: 'finance.read',
    routes: [
      { path: '/finance', label: 'Finans', component: () => import('../features/finance/FinancePage') },
    ],
  },
  {
    key: 'vault',
    label: 'Şifre Kasası',
    icon: 'lock',
    licenseKey: 'vault',
    permission: 'vault.use',
    desktopOnly: true,
    routes: [
      { path: '/vault', label: 'Şifre Kasası', component: () => import('../features/vault/VaultPage') },
    ],
  },
];

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { vganttDesktop?: unknown }).vganttDesktop);
}

export interface NavContext {
  permissions: readonly string[];
  enabledModules: readonly string[];
}

export function visibleModules(context: NavContext): ModuleDescriptor[] {
  return MODULES.filter((module) => {
    if (module.licenseKey && !context.enabledModules.includes(module.licenseKey)) return false;
    if (module.permission && !context.permissions.includes(module.permission)) return false;
    return true;
  });
}
