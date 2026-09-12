/** A single credential record. Lives only on the user's machine. */
export interface VaultEntry {
  id: string;
  title: string;
  category: string;
  url: string;
  username: string;
  password: string;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type VaultEntryInput = Partial<Omit<VaultEntry, 'id' | 'createdAt' | 'updatedAt'>> &
  Pick<VaultEntry, 'title'>;

export interface VaultMeta {
  schemaVersion: number;
  encryption: 'aes-256-gcm' | 'none';
  kdfAlgorithm: string;
  kdfIterations: number;
  kdfSalt: string;
  verifier: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Storage boundary.
 *
 * Everything the vault needs from the outside world is these four calls, which
 * is what makes the same core run in the Electron main process (real files
 * under C:/Rsdw), in a browser through the File System Access API, and in
 * memory during tests.
 */
export interface VaultFileAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  ensureDirectory(directory: string): Promise<void>;
}

export interface VaultOpenOptions {
  /** false writes the sheet in plain text. Strongly discouraged; see docs. */
  encrypt?: boolean;
  iterations?: number;
}
