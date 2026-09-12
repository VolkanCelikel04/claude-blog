import type { VaultFileAdapter } from '../types.ts';

/** In-memory storage for tests and previews. */
export class MemoryAdapter implements VaultFileAdapter {
  private readonly files = new Map<string, Uint8Array>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw new Error(`Dosya bulunamadı: ${path}`);
    return data;
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, new Uint8Array(data));
  }

  async ensureDirectory(): Promise<void> {
    // no-op
  }

  snapshot(): Map<string, Uint8Array> {
    return new Map(this.files);
  }
}
