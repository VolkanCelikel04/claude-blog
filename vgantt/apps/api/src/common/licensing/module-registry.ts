/**
 * The backend's view of the module catalogue.
 *
 * platform.modules is the source of truth at runtime; this registry exists so
 * that route metadata, permission names and the "is this module allowed to
 * touch the database at all" flag are checkable at compile time.
 *
 * Adding a module means: one entry here, one row in platform.modules (shipped
 * by the module's own migration), one NestJS module. See docs/ADDING-A-MODULE.md.
 */
export const MODULE_KEYS = ['licenses', 'finance', 'vault'] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDefinition {
  key: ModuleKey;
  name: string;
  /** Route prefix owned by this module. */
  basePath: string;
  /** Permissions the module contributes. Must match app.permissions. */
  permissions: readonly string[];
  /**
   * false => the module is contractually forbidden from persisting user data
   * server-side. The API must expose no endpoint that accepts its payload.
   */
  storesServerData: boolean;
  /** Needs the Electron desktop shell (local filesystem access). */
  requiresDesktop: boolean;
}

export const MODULE_REGISTRY: Readonly<Record<ModuleKey, ModuleDefinition>> = {
  licenses: {
    key: 'licenses',
    name: 'Lisans ve Süre Takibi',
    basePath: 'licenses',
    permissions: ['licenses.read', 'licenses.write', 'licenses.delete', 'licenses.renew'],
    storesServerData: true,
    requiresDesktop: false,
  },
  finance: {
    key: 'finance',
    name: 'Finans ve Ödeme Takibi',
    basePath: 'finance',
    permissions: [
      'finance.read',
      'finance.expense.write',
      'finance.invoice.write',
      'finance.payment.write',
      'finance.delete',
      'finance.report',
    ],
    storesServerData: true,
    requiresDesktop: false,
  },
  vault: {
    key: 'vault',
    name: 'Yerel Şifre Kasası',
    basePath: 'vault',
    // Entries never reach the server. The only endpoints are workstation
    // metadata (device label, file path, entry COUNT) - see modules/vault.
    permissions: ['vault.use', 'vault.export'],
    storesServerData: false,
    requiresDesktop: true,
  },
};

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}
