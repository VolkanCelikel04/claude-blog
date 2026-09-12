import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
 * C:/Rsdw on Windows, as specified.
 *
 * On macOS/Linux (developer machines, CI) the same layout is created under the
 * user's home directory so the code path is identical everywhere.
 */
export function defaultVaultDirectory(): string {
  if (process.platform === 'win32') return 'C:/Rsdw';
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  return join(home, 'Rsdw');
}

export function defaultVaultPath(fileName = 'vault.xlsx'): string {
  return `${defaultVaultDirectory()}/${fileName}`;
}
