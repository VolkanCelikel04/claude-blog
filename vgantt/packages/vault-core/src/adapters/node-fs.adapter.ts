import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveVaultDirectory, resolveVaultPath, VAULT_FILE_NAME } from '../vault-location.ts';
import type { VaultFileAdapter } from '../types.ts';

/**
 * Real files, for the Electron main process.
 *
 * Writes go to a temporary file and are renamed into place, and the previous
 * version is copied to <name>.bak first. A vault that loses data on a crash
 * mid-save is worse than no vault, and rename() is atomic on the same volume.
 */
export class NodeFsAdapter implements VaultFileAdapter {
  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(path));
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await this.ensureDirectory(dirname(path));

    if (await this.exists(path)) {
      await copyFile(path, `${path}.bak`);
    }

    const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, path);
  }

  async ensureDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
}

/**
 * Platform-standard vault directory. The policy - including which cloud-sync
 * opt-out each platform needs - lives in vault-location.ts so the desktop shell
 * and the mobile shells cannot drift apart.
 */
export function defaultVaultDirectory(): string {
  return resolveVaultDirectory();
}

export function defaultVaultPath(fileName = VAULT_FILE_NAME): string {
  return resolveVaultPath({ fileName });
}
