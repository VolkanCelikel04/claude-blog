/**
 * MODULE C - Yerel Şifre Kasası
 *
 * KESİN KURAL: bu dosyadaki hiçbir kod ağ çağrısı yapmaz. Kasa içeriği
 * yalnızca yerel dosya sistemine (varsayılan: C:/Rsdw/vault.xlsx) yazılır.
 * There is no fetch, no XMLHttpRequest, no WebSocket and no import that could
 * perform one - a property that test/vault.test.ts asserts mechanically.
 *
 * The file is a real .xlsx: a person can open it in Excel and see their rows.
 * The username/password/notes columns hold AES-256-GCM ciphertext, so copying
 * the file off the machine yields nothing without the master password.
 */
import { readWorkbook, writeWorkbook, type Sheet } from './xlsx/workbook.ts';
import {
  checkVerifier, decryptField, deriveKey, encryptField, fieldAad, makeVerifier,
  newKdfParams, VaultDecryptionError, type KdfParams,
} from './crypto.ts';
import type { VaultEntry, VaultEntryInput, VaultFileAdapter, VaultMeta, VaultOpenOptions } from './types.ts';

export const ENTRY_SHEET = 'Kasa';
export const META_SHEET = '_vgantt_meta';
export const SCHEMA_VERSION = 1;

/** Column order of the "Kasa" sheet. Changing it needs a schema bump. */
const HEADERS = [
  'ID', 'Başlık', 'Kategori', 'Adres', 'Kullanıcı Adı', 'Şifre',
  'Notlar', 'Etiketler', 'Oluşturulma', 'Güncelleme',
] as const;

/** Encrypted columns. Everything else stays readable in Excel. */
const SECRET_FIELDS = ['username', 'password', 'notes'] as const;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export class Vault {
  readonly path: string;

  private readonly adapter: VaultFileAdapter;
  private key: CryptoKey | null;
  private meta: VaultMeta;
  private entries: VaultEntry[];

  private constructor(
    adapter: VaultFileAdapter,
    path: string,
    key: CryptoKey | null,
    meta: VaultMeta,
    entries: VaultEntry[],
  ) {
    this.adapter = adapter;
    this.path = path;
    this.key = key;
    this.meta = meta;
    this.entries = entries;
  }

  // ------------------------------------------------------------------ open
  /**
   * Opens the vault at `path`, creating the file (and its directory) when it
   * does not exist yet - "dosya yoksa program otomatik oluşturmalı".
   */
  static async openOrCreate(
    adapter: VaultFileAdapter,
    path: string,
    masterPassword: string,
    options: VaultOpenOptions = {},
  ): Promise<Vault> {
    if (await adapter.exists(path)) {
      return Vault.open(adapter, path, masterPassword);
    }
    return Vault.create(adapter, path, masterPassword, options);
  }

  static async create(
    adapter: VaultFileAdapter,
    path: string,
    masterPassword: string,
    options: VaultOpenOptions = {},
  ): Promise<Vault> {
    const encrypt = options.encrypt !== false;

    if (encrypt && masterPassword.length < 8) {
      throw new VaultError('Ana şifre en az 8 karakter olmalıdır.');
    }

    const kdf: KdfParams = newKdfParams(options.iterations);
    const key = encrypt ? await deriveKey(masterPassword, kdf) : null;
    const now = new Date().toISOString();

    const meta: VaultMeta = {
      schemaVersion: SCHEMA_VERSION,
      encryption: encrypt ? 'aes-256-gcm' : 'none',
      kdfAlgorithm: kdf.algorithm,
      kdfIterations: kdf.iterations,
      kdfSalt: kdf.salt,
      verifier: key ? await makeVerifier(key) : '',
      createdAt: now,
      updatedAt: now,
    };

    const vault = new Vault(adapter, path, key, meta, []);
    await vault.save();
    return vault;
  }

  static async open(
    adapter: VaultFileAdapter,
    path: string,
    masterPassword: string,
  ): Promise<Vault> {
    const buffer = Buffer.from(await adapter.read(path));
    const sheets = readWorkbook(buffer);

    const metaSheet = sheets.find((s) => s.name === META_SHEET);
    const entrySheet = sheets.find((s) => s.name === ENTRY_SHEET);
    if (!entrySheet) {
      throw new VaultError(`"${ENTRY_SHEET}" sayfası bulunamadı; bu bir Vgantt kasa dosyası değil.`);
    }

    const meta = parseMeta(metaSheet);

    let key: CryptoKey | null = null;
    if (meta.encryption === 'aes-256-gcm') {
      key = await deriveKey(masterPassword, {
        algorithm: 'pbkdf2-sha256',
        iterations: meta.kdfIterations,
        salt: meta.kdfSalt,
      });

      if (meta.verifier && !(await checkVerifier(key, meta.verifier))) {
        throw new VaultError('Ana şifre hatalı.');
      }
    }

    const entries = await decodeEntries(entrySheet, key);
    return new Vault(adapter, path, key, meta, entries);
  }

  // ------------------------------------------------------------ row access
  list(): VaultEntry[] {
    return this.entries.map((entry) => ({ ...entry, tags: [...entry.tags] }));
  }

  get(id: string): VaultEntry | undefined {
    const entry = this.entries.find((e) => e.id === id);
    return entry ? { ...entry, tags: [...entry.tags] } : undefined;
  }

  search(query: string): VaultEntry[] {
    const needle = query.trim().toLocaleLowerCase('tr');
    if (!needle) return this.list();

    return this.list().filter((entry) =>
      [entry.title, entry.category, entry.url, entry.username, entry.tags.join(' ')]
        .join(' ')
        .toLocaleLowerCase('tr')
        .includes(needle),
    );
  }

  add(input: VaultEntryInput): VaultEntry {
    if (!input.title?.trim()) throw new VaultError('Başlık zorunludur.');

    const now = new Date().toISOString();
    const entry: VaultEntry = {
      id: globalThis.crypto.randomUUID(),
      title: input.title.trim(),
      category: input.category ?? '',
      url: input.url ?? '',
      username: input.username ?? '',
      password: input.password ?? '',
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.entries.push(entry);
    return { ...entry };
  }

  update(id: string, patch: Partial<VaultEntryInput>): VaultEntry {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index < 0) throw new VaultError('Kayıt bulunamadı.');

    const updated: VaultEntry = {
      ...this.entries[index],
      ...patch,
      tags: patch.tags ?? this.entries[index].tags,
      updatedAt: new Date().toISOString(),
    };

    this.entries[index] = updated;
    return { ...updated };
  }

  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    return this.entries.length < before;
  }

  get size(): number {
    return this.entries.length;
  }

  get encryption(): VaultMeta['encryption'] {
    return this.meta.encryption;
  }

  // ----------------------------------------------------------------- save
  async save(): Promise<void> {
    this.meta = { ...this.meta, updatedAt: new Date().toISOString() };

    const rows: string[][] = [[...HEADERS]];
    for (const entry of this.entries) {
      rows.push([
        entry.id,
        entry.title,
        entry.category,
        entry.url,
        await this.protect(entry.id, 'username', entry.username),
        await this.protect(entry.id, 'password', entry.password),
        await this.protect(entry.id, 'notes', entry.notes),
        entry.tags.join(', '),
        entry.createdAt,
        entry.updatedAt,
      ]);
    }

    const sheets: Sheet[] = [
      { name: ENTRY_SHEET, rows },
      { name: META_SHEET, rows: renderMeta(this.meta, this.entries.length) },
    ];

    await this.adapter.write(this.path, writeWorkbook(sheets));
  }

  /**
   * Re-encrypts every row under a new master password. The salt is rotated too,
   * so the old derived key is useless against the new file.
   */
  async changeMasterPassword(currentPassword: string, newPassword: string): Promise<void> {
    if (this.meta.encryption !== 'aes-256-gcm') {
      throw new VaultError('Şifrelemesi kapalı bir kasada ana şifre değiştirilemez.');
    }
    if (newPassword.length < 8) {
      throw new VaultError('Yeni ana şifre en az 8 karakter olmalıdır.');
    }

    const currentKey = await deriveKey(currentPassword, {
      algorithm: 'pbkdf2-sha256',
      iterations: this.meta.kdfIterations,
      salt: this.meta.kdfSalt,
    });
    if (!(await checkVerifier(currentKey, this.meta.verifier))) {
      throw new VaultError('Mevcut ana şifre hatalı.');
    }

    const kdf = newKdfParams(this.meta.kdfIterations);
    const nextKey = await deriveKey(newPassword, kdf);

    // Entries are already decrypted in memory; rewriting under the new key is
    // just a save with rotated parameters.
    this.key = nextKey;
    this.meta = {
      ...this.meta,
      kdfSalt: kdf.salt,
      kdfIterations: kdf.iterations,
      verifier: await makeVerifier(nextKey),
    };

    await this.save();
  }

  /** Writes a timestamped copy next to the vault (still local, never uploaded). */
  async backup(directory?: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = this.path.replace(/\.xlsx$/i, '');
    const target = directory
      ? `${directory.replace(/[\\/]+$/, '')}/${base.split(/[\\/]/).pop()}-${stamp}.xlsx`
      : `${base}-${stamp}.xlsx`;

    await this.adapter.write(target, await this.adapter.read(this.path));
    return target;
  }

  private async protect(entryId: string, field: string, value: string): Promise<string> {
    if (!this.key) return value;
    return encryptField(this.key, value, fieldAad(entryId, field));
  }
}

// ---------------------------------------------------------------- helpers
async function decodeEntries(sheet: Sheet, key: CryptoKey | null): Promise<VaultEntry[]> {
  const entries: VaultEntry[] = [];

  for (const [index, row] of sheet.rows.entries()) {
    if (index === 0) continue;                 // header
    if (!row || row.every((cell) => !cell)) continue;

    const id = row[0]?.trim();
    if (!id) continue;

    const reveal = async (position: number, field: (typeof SECRET_FIELDS)[number]) => {
      const raw = row[position] ?? '';
      if (!key) return raw;
      return decryptField(key, raw, fieldAad(id, field));
    };

    entries.push({
      id,
      title: row[1] ?? '',
      category: row[2] ?? '',
      url: row[3] ?? '',
      username: await reveal(4, 'username'),
      password: await reveal(5, 'password'),
      notes: await reveal(6, 'notes'),
      tags: (row[7] ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      createdAt: row[8] ?? '',
      updatedAt: row[9] ?? '',
    });
  }

  return entries;
}

function renderMeta(meta: VaultMeta, entryCount: number): string[][] {
  return [
    ['Anahtar', 'Değer'],
    ['schemaVersion', String(meta.schemaVersion)],
    ['encryption', meta.encryption],
    ['kdfAlgorithm', meta.kdfAlgorithm],
    ['kdfIterations', String(meta.kdfIterations)],
    ['kdfSalt', meta.kdfSalt],
    ['verifier', meta.verifier],
    ['createdAt', meta.createdAt],
    ['updatedAt', meta.updatedAt],
    ['entryCount', String(entryCount)],
    ['uyari', 'Bu dosya yerel kalmalidir. Sunucuya yuklenmez, e-posta ile gonderilmez.'],
  ];
}

function parseMeta(sheet: Sheet | undefined): VaultMeta {
  const now = new Date().toISOString();
  const values = new Map<string, string>();

  for (const row of sheet?.rows ?? []) {
    if (row[0]) values.set(row[0], row[1] ?? '');
  }

  const encryption = values.get('encryption') === 'none' ? 'none' : 'aes-256-gcm';
  const salt = values.get('kdfSalt') ?? '';

  if (encryption === 'aes-256-gcm' && !salt) {
    throw new VaultError(
      'Kasa meta verisi eksik (kdfSalt). Dosya bozulmuş olabilir; .bak yedeğini deneyin.',
    );
  }

  return {
    schemaVersion: Number(values.get('schemaVersion') ?? SCHEMA_VERSION),
    encryption,
    kdfAlgorithm: values.get('kdfAlgorithm') ?? 'pbkdf2-sha256',
    kdfIterations: Number(values.get('kdfIterations') ?? 600_000),
    kdfSalt: salt,
    verifier: values.get('verifier') ?? '',
    createdAt: values.get('createdAt') ?? now,
    updatedAt: values.get('updatedAt') ?? now,
  };
}

export { VaultDecryptionError };
