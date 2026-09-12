import type { VaultFileAdapter } from '../types.ts';

/**
 * Browser fallback, for deployments without the desktop shell.
 *
 * A web page cannot be handed an absolute path: the File System Access API
 * requires the user to pick the location once, after which the handle can be
 * kept in IndexedDB and reused. So "C:/Rsdw" becomes "the folder the user
 * chose, which we ask them to create as C:\Rsdw" - the guarantee that matters
 * (nothing leaves the machine) is unchanged, the path is merely advisory.
 *
 * Runtime note: vault-core's ZIP layer uses node:zlib, so it runs in the
 * Electron MAIN process, not in a page. This adapter exists for a future
 * browser-hosted build, which would additionally need a DEFLATE implementation
 * (CompressionStream('deflate-raw')) wired into src/xlsx/zip.ts. The security
 * guarantee is identical either way: bytes never leave the machine.
 *
 * See docs/SECURITY-VAULT.md for why the Electron shell is the recommended
 * deployment.
 */
interface FileSystemFileHandleLike {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

interface FileSystemDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
}

export class FileSystemAccessAdapter implements VaultFileAdapter {
  private readonly directory: FileSystemDirectoryHandleLike;

  constructor(directory: FileSystemDirectoryHandleLike) {
    this.directory = directory;
  }

  private fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? 'vault.xlsx';
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.directory.getFileHandle(this.fileName(path));
      return true;
    } catch {
      return false;
    }
  }

  async read(path: string): Promise<Uint8Array> {
    const handle = await this.directory.getFileHandle(this.fileName(path));
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const handle = await this.directory.getFileHandle(this.fileName(path), { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  async ensureDirectory(): Promise<void> {
    // The user already granted a directory handle; nothing to create.
  }
}
