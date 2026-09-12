import { ipcMain, app, dialog, clipboard } from 'electron';
import { Vault, NodeFsAdapter, defaultVaultPath, defaultVaultDirectory } from '@vgantt/vault-core';
import type { VaultEntry, VaultEntryInput } from '@vgantt/vault-core';

/**
 * The vault lives here, in the main process, and nowhere else.
 *
 * The renderer gets a narrow message API - open, list, add, update, remove,
 * save - and never sees the master password after it is submitted, never sees
 * the derived key, and has no filesystem access of its own. Even a full XSS in
 * the UI cannot read the vault file directly; it can only ask main for entries
 * it is already entitled to see, in a window that is already unlocked.
 */
let vault: Vault | null = null;
let autoLockTimer: NodeJS.Timeout | null = null;

const AUTO_LOCK_MS = 10 * 60 * 1000;
const adapter = new NodeFsAdapter();

export interface VaultStatus {
  unlocked: boolean;
  path: string;
  directory: string;
  exists: boolean;
  entryCount: number;
  encryption: 'aes-256-gcm' | 'none' | null;
}

function resetAutoLock(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => {
    vault = null;
  }, AUTO_LOCK_MS);
}

function requireVault(): Vault {
  if (!vault) throw new Error('Kasa kilitli. Lütfen ana şifrenizle tekrar açın.');
  resetAutoLock();
  return vault;
}

export function registerVaultHandlers(): void {
  ipcMain.handle('vault:status', async (_event, path?: string): Promise<VaultStatus> => {
    const target = path ?? defaultVaultPath();
    return {
      unlocked: vault !== null,
      path: target,
      directory: defaultVaultDirectory(),
      exists: await adapter.exists(target),
      entryCount: vault?.size ?? 0,
      encryption: vault?.encryption ?? null,
    };
  });

  /**
   * Opens the file, creating C:/Rsdw and vault.xlsx when they do not exist yet.
   * This is the only place the master password is ever handled.
   */
  ipcMain.handle(
    'vault:unlock',
    async (_event, args: { masterPassword: string; path?: string }): Promise<VaultStatus> => {
      const target = args.path ?? defaultVaultPath();
      vault = await Vault.openOrCreate(adapter, target, args.masterPassword);
      resetAutoLock();

      return {
        unlocked: true,
        path: target,
        directory: defaultVaultDirectory(),
        exists: true,
        entryCount: vault.size,
        encryption: vault.encryption,
      };
    },
  );

  ipcMain.handle('vault:lock', async () => {
    vault = null;
    if (autoLockTimer) clearTimeout(autoLockTimer);
    return { unlocked: false };
  });

  /**
   * Entries are returned WITHOUT the password field. The UI shows a masked
   * cell and asks for the value only when the user explicitly reveals or
   * copies one, which keeps plaintext out of renderer memory by default.
   */
  ipcMain.handle('vault:list', async (): Promise<Omit<VaultEntry, 'password'>[]> =>
    requireVault()
      .list()
      .map(({ password: _password, ...rest }) => rest),
  );

  ipcMain.handle('vault:reveal', async (_event, id: string): Promise<string> => {
    const entry = requireVault().get(id);
    if (!entry) throw new Error('Kayıt bulunamadı.');
    return entry.password;
  });

  /** Copy without the password passing through the renderer at all. */
  ipcMain.handle('vault:copyPassword', async (_event, id: string): Promise<boolean> => {
    const entry = requireVault().get(id);
    if (!entry) throw new Error('Kayıt bulunamadı.');

    clipboard.writeText(entry.password);
    setTimeout(() => {
      if (clipboard.readText() === entry.password) clipboard.clear();
    }, 30_000);

    return true;
  });

  ipcMain.handle('vault:add', async (_event, input: VaultEntryInput) => {
    const current = requireVault();
    const entry = current.add(input);
    await current.save();
    const { password: _password, ...rest } = entry;
    return rest;
  });

  ipcMain.handle('vault:update', async (_event, args: { id: string; patch: Partial<VaultEntryInput> }) => {
    const current = requireVault();
    const entry = current.update(args.id, args.patch);
    await current.save();
    const { password: _password, ...rest } = entry;
    return rest;
  });

  ipcMain.handle('vault:remove', async (_event, id: string) => {
    const current = requireVault();
    const removed = current.remove(id);
    await current.save();
    return removed;
  });

  ipcMain.handle('vault:search', async (_event, query: string) =>
    requireVault()
      .search(query)
      .map(({ password: _password, ...rest }) => rest),
  );

  ipcMain.handle(
    'vault:changeMasterPassword',
    async (_event, args: { current: string; next: string }) => {
      await requireVault().changeMasterPassword(args.current, args.next);
      return true;
    },
  );

  ipcMain.handle('vault:backup', async () => {
    const current = requireVault();
    const result = await dialog.showOpenDialog({
      title: 'Yedek klasörünü seçin',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultVaultDirectory(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    return current.backup(result.filePaths[0]);
  });

  /**
   * The ONLY thing that goes to the server: a device label and a row count.
   * Sending anything else from here would be a bug; the API rejects it anyway
   * (NoSecretPayloadGuard) and the database has no column to hold it.
   */
  ipcMain.handle('vault:metadataForServer', async () => {
    const current = requireVault();
    return {
      deviceLabel: process.env.COMPUTERNAME ?? app.getPath('home').split(/[\\/]/).pop() ?? 'bilinmeyen',
      vaultPath: current.path,
      entryCount: current.size,
    };
  });
}

/** Called on quit so a derived key never outlives the process by accident. */
export function disposeVault(): void {
  vault = null;
  if (autoLockTimer) clearTimeout(autoLockTimer);
}
