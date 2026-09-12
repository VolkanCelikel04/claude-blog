import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Vault, VaultError } from '../src/vault.ts';
import { zipRead } from '../src/xlsx/zip.ts';
import { MemoryAdapter } from '../src/adapters/memory.adapter.ts';
import { NodeFsAdapter, defaultVaultPath, defaultVaultDirectory } from '../src/adapters/node-fs.adapter.ts';
import { readWorkbook } from '../src/xlsx/workbook.ts';

const MASTER = 'Cok-Gizli-Ana-Sifre-2026';
const FAST = { iterations: 1000 }; // keep the suite quick; production uses 600k

describe('vault file lifecycle', () => {
  test('creates the file when it does not exist yet', async () => {
    const adapter = new MemoryAdapter();
    assert.equal(await adapter.exists('C:/Rsdw/vault.xlsx'), false);

    const vault = await Vault.openOrCreate(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);

    assert.equal(await adapter.exists('C:/Rsdw/vault.xlsx'), true);
    assert.equal(vault.size, 0);
    assert.equal(vault.encryption, 'aes-256-gcm');
  });

  test('opens an existing file instead of overwriting it', async () => {
    const adapter = new MemoryAdapter();
    const first = await Vault.openOrCreate(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);
    first.add({ title: 'Banka', username: 'volkan', password: 'p1' });
    await first.save();

    const second = await Vault.openOrCreate(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);
    assert.equal(second.size, 1);
    assert.equal(second.list()[0].title, 'Banka');
  });

  test('row-level read / write / delete survives a save-reopen cycle', async () => {
    const adapter = new MemoryAdapter();
    const vault = await Vault.create(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);

    const mail = vault.add({
      title: 'Şirket e-postası',
      category: 'E-posta',
      url: 'https://outlook.office.com',
      username: 'volkan@acme.example',
      password: 'Bu-Şifre-Çok-Güçlü-42!',
      notes: 'İki adımlı doğrulama açık',
      tags: ['ofis', 'kritik'],
    });
    const bank = vault.add({ title: 'Banka', username: 'TR12', password: 'bank-pass' });
    vault.add({ title: 'Silinecek', username: 'x', password: 'y' });

    vault.update(bank.id, { password: 'yeni-banka-sifresi' });
    assert.equal(vault.remove(vault.list()[2].id), true);
    await vault.save();

    const reopened = await Vault.open(adapter, 'C:/Rsdw/vault.xlsx', MASTER);
    assert.equal(reopened.size, 2);

    const restored = reopened.get(mail.id);
    assert.ok(restored);
    assert.equal(restored.title, 'Şirket e-postası');
    assert.equal(restored.username, 'volkan@acme.example');
    assert.equal(restored.password, 'Bu-Şifre-Çok-Güçlü-42!');
    assert.equal(restored.notes, 'İki adımlı doğrulama açık');
    assert.deepEqual(restored.tags, ['ofis', 'kritik']);

    assert.equal(reopened.get(bank.id)?.password, 'yeni-banka-sifresi');
  });

  test('search matches Turkish text case-insensitively', async () => {
    const adapter = new MemoryAdapter();
    const vault = await Vault.create(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);
    vault.add({ title: 'ŞİRKET Portalı', username: 'a', password: 'b' });
    vault.add({ title: 'Kişisel', username: 'c', password: 'd' });

    assert.equal(vault.search('şirket').length, 1);
    assert.equal(vault.search('portal').length, 1);
    assert.equal(vault.search('').length, 2);
  });
});

describe('encryption', () => {
  test('passwords are not readable in the raw file', async () => {
    const adapter = new MemoryAdapter();
    const vault = await Vault.create(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);
    vault.add({
      title: 'Kritik sistem',
      username: 'kullanici-adi-gizli',
      password: 'COK-GIZLI-SIFRE-12345',
      notes: 'gizli-not-icerigi',
    });
    await vault.save();

    // Decompress first: the workbook parts are deflated inside the ZIP, so
    // searching the raw bytes would pass even for a plaintext vault.
    const parts = decompressedText(await adapter.read('C:/Rsdw/vault.xlsx'));
    assert.ok(!parts.includes('COK-GIZLI-SIFRE-12345'), 'password must not appear in the file');
    assert.ok(!parts.includes('kullanici-adi-gizli'), 'username must not appear in the file');
    assert.ok(!parts.includes('gizli-not-icerigi'), 'notes must not appear in the file');
    assert.ok(parts.includes('Kritik sistem'), 'non-secret columns stay readable');

    // The non-secret columns stay legible, so the file is still useful in Excel.
    const sheets = readWorkbook(Buffer.from(await adapter.read('C:/Rsdw/vault.xlsx')));
    const kasa = sheets.find((s) => s.name === 'Kasa');
    assert.equal(kasa?.rows[1][1], 'Kritik sistem');
    assert.ok(kasa?.rows[1][5].startsWith('enc:v1:'), 'password cell holds ciphertext');
  });

  test('a wrong master password is rejected, not silently mis-decrypted', async () => {
    const adapter = new MemoryAdapter();
    const vault = await Vault.create(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);
    vault.add({ title: 'x', username: 'u', password: 'p' });
    await vault.save();

    await assert.rejects(
      () => Vault.open(adapter, 'C:/Rsdw/vault.xlsx', 'yanlis-sifre'),
      (error: Error) => error instanceof VaultError && /Ana şifre hatalı/.test(error.message),
    );
  });

  test('a ciphertext moved to another row fails to decrypt (AAD binding)', async () => {
    const adapter = new MemoryAdapter();
    const vault = await Vault.create(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);
    vault.add({ title: 'A', username: 'a-user', password: 'a-pass' });
    vault.add({ title: 'B', username: 'b-user', password: 'b-pass' });
    await vault.save();

    // Tamper: copy row A's password ciphertext into row B.
    const { writeWorkbook } = await import('../src/xlsx/workbook.ts');
    const sheets = readWorkbook(Buffer.from(await adapter.read('C:/Rsdw/vault.xlsx')));
    const kasa = sheets.find((s) => s.name === 'Kasa')!;
    kasa.rows[2][5] = kasa.rows[1][5];
    await adapter.write('C:/Rsdw/vault.xlsx', writeWorkbook(sheets));

    await assert.rejects(
      () => Vault.open(adapter, 'C:/Rsdw/vault.xlsx', MASTER),
      /çözülemedi/,
    );
  });

  test('changing the master password rotates the salt and re-encrypts', async () => {
    const adapter = new MemoryAdapter();
    const vault = await Vault.create(adapter, 'C:/Rsdw/vault.xlsx', MASTER, FAST);
    vault.add({ title: 'Kayıt', username: 'u', password: 'gizli' });
    await vault.save();

    const saltBefore = metaValue(await adapter.read('C:/Rsdw/vault.xlsx'), 'kdfSalt');

    await vault.changeMasterPassword(MASTER, 'Yepyeni-Ana-Sifre-2027');

    const saltAfter = metaValue(await adapter.read('C:/Rsdw/vault.xlsx'), 'kdfSalt');
    assert.notEqual(saltBefore, saltAfter, 'salt must be rotated');

    await assert.rejects(() => Vault.open(adapter, 'C:/Rsdw/vault.xlsx', MASTER));

    const reopened = await Vault.open(adapter, 'C:/Rsdw/vault.xlsx', 'Yepyeni-Ana-Sifre-2027');
    assert.equal(reopened.get(reopened.list()[0].id)?.password, 'gizli');
  });

  test('opt-out plaintext mode is possible but clearly marked', async () => {
    const adapter = new MemoryAdapter();
    const vault = await Vault.create(adapter, 'C:/Rsdw/plain.xlsx', '', { encrypt: false });
    vault.add({ title: 'Açık', username: 'u', password: 'gorunur-sifre' });
    await vault.save();

    const parts = decompressedText(await adapter.read('C:/Rsdw/plain.xlsx'));
    assert.ok(parts.includes('gorunur-sifre'), 'plaintext mode really does store the password as-is');
    assert.equal(vault.encryption, 'none');

    const reopened = await Vault.open(adapter, 'C:/Rsdw/plain.xlsx', '');
    assert.equal(reopened.get(reopened.list()[0].id)?.password, 'gorunur-sifre');
  });
});

describe('the module never talks to a server', () => {
  test('no source file references a network API', () => {
    const sources = collectSources(new URL('../src', import.meta.url).pathname);
    const forbidden = /\b(fetch|XMLHttpRequest|WebSocket|navigator\.sendBeacon)\s*\(|require\(['"](https?|net|dgram|node:https?|node:net)['"]\)|from\s+['"](node:https?|node:net|node:dgram|axios)['"]/;

    for (const file of sources) {
      const code = readFileSync(file, 'utf8');
      // Strip comments so prose about "fetch" does not trip the check.
      const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.ok(
        !forbidden.test(stripped),
        `${file} must not contain network calls - module C data stays on the machine`,
      );
    }
  });

  test('only node:fs, node:path and node:zlib are imported', () => {
    const sources = collectSources(new URL('../src', import.meta.url).pathname);
    const allowed = new Set(['node:fs', 'node:fs/promises', 'node:path', 'node:zlib']);

    for (const file of sources) {
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/from\s+['"](node:[^'"]+)['"]/g)) {
        assert.ok(allowed.has(match[1]), `${file} imports unexpected builtin ${match[1]}`);
      }
    }
  });
});

describe('real filesystem adapter', () => {
  test('writes atomically under the vault directory and keeps a .bak', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vgantt-vault-'));
    const path = join(directory, 'Rsdw', 'vault.xlsx');

    try {
      const adapter = new NodeFsAdapter();
      const vault = await Vault.openOrCreate(adapter, path, MASTER, FAST);
      vault.add({ title: 'Disk kaydı', username: 'u', password: 'p' });
      await vault.save();
      await vault.save(); // second save produces the backup

      const files = readdirSync(join(directory, 'Rsdw'));
      assert.ok(files.includes('vault.xlsx'));
      assert.ok(files.includes('vault.xlsx.bak'), 'previous version is preserved');
      assert.ok(!files.some((f) => f.includes('.tmp-')), 'no temp file is left behind');

      const reopened = await Vault.open(adapter, path, MASTER);
      assert.equal(reopened.get(reopened.list()[0].id)?.password, 'p');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('the default path is C:/Rsdw on Windows', () => {
    const directory = defaultVaultDirectory();
    if (process.platform === 'win32') {
      assert.equal(directory, 'C:/Rsdw');
      assert.equal(defaultVaultPath(), 'C:/Rsdw/vault.xlsx');
    } else {
      assert.ok(directory.endsWith('/Rsdw'), `dev fallback keeps the Rsdw layout: ${directory}`);
    }
  });
});

// ------------------------------------------------------------------ helpers
/** Every workbook part, inflated and concatenated - what an attacker would grep. */
function decompressedText(data: Uint8Array): string {
  const files = zipRead(Buffer.from(data));
  return [...files.values()].map((buffer) => buffer.toString('utf8')).join('\n');
}

function metaValue(data: Uint8Array, key: string): string {
  const sheets = readWorkbook(Buffer.from(data));
  const meta = sheets.find((s) => s.name === '_vgantt_meta');
  return meta?.rows.find((row) => row[0] === key)?.[1] ?? '';
}

function collectSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...collectSources(full));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}
