/**
 * Typed view of the preload bridge (window.vganttVault).
 *
 * Note what the renderer can and cannot do. It can list entries - without
 * passwords - and ask the main process to reveal or copy exactly one password
 * on an explicit user action. It cannot read the file, cannot get the master
 * password back, and cannot ask for every secret at once.
 */
export interface VaultStatus {
  unlocked: boolean;
  path: string;
  directory: string;
  exists: boolean;
  entryCount: number;
  encryption: 'aes-256-gcm' | 'none' | null;
}

export interface VaultEntrySummary {
  id: string;
  title: string;
  category: string;
  url: string;
  username: string;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VaultBridge {
  status(path?: string): Promise<VaultStatus>;
  unlock(masterPassword: string, path?: string): Promise<VaultStatus>;
  lock(): Promise<{ unlocked: boolean }>;
  list(): Promise<VaultEntrySummary[]>;
  search(query: string): Promise<VaultEntrySummary[]>;
  add(input: Record<string, unknown>): Promise<VaultEntrySummary>;
  update(id: string, patch: Record<string, unknown>): Promise<VaultEntrySummary>;
  remove(id: string): Promise<boolean>;
  reveal(id: string): Promise<string>;
  copyPassword(id: string): Promise<boolean>;
  changeMasterPassword(current: string, next: string): Promise<boolean>;
  backup(): Promise<string | null>;
  metadataForServer(): Promise<{ deviceLabel: string; vaultPath: string; entryCount: number }>;
}

declare global {
  interface Window {
    vganttVault?: VaultBridge;
    vganttDesktop?: { isDesktop: true; platform: string; version: string };
  }
}

export function vaultBridge(): VaultBridge | null {
  return window.vganttVault ?? null;
}
