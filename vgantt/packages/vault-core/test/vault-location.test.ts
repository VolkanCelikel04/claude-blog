import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveVaultDirectory, resolveVaultPath, backupExclusionFor,
  VAULT_LOCATIONS, VAULT_FOLDER,
} from '../src/vault-location.ts';

describe('vault location per platform', () => {
  test('Windows: drive root, outside the OneDrive-synced profile folders', () => {
    assert.equal(
      resolveVaultDirectory({ platform: 'win32', env: {} }),
      'C:/Rsdw',
    );
    assert.equal(
      resolveVaultPath({ platform: 'win32', env: {} }),
      'C:/Rsdw/vault.xlsx',
    );
  });

  test('Windows: honours a relocated system drive', () => {
    assert.equal(
      resolveVaultDirectory({ platform: 'win32', env: { SystemDrive: 'D:' } }),
      'D:/Rsdw',
    );
  });

  test('macOS: Application Support, never ~/Documents', () => {
    const directory = resolveVaultDirectory({
      platform: 'darwin',
      env: { HOME: '/Users/volkan' },
    });

    assert.equal(directory, '/Users/volkan/Library/Application Support/Rsdw');
    // ~/Documents is uploaded when iCloud Drive's Desktop & Documents sync is on.
    assert.ok(!directory.includes('/Documents'), 'must not land in ~/Documents');
  });

  test('Linux: XDG data directory', () => {
    assert.equal(
      resolveVaultDirectory({ platform: 'linux', env: { HOME: '/home/volkan' } }),
      '/home/volkan/.local/share/Rsdw',
    );
    assert.equal(
      resolveVaultDirectory({
        platform: 'linux',
        env: { HOME: '/home/volkan', XDG_DATA_HOME: '/mnt/data/share' },
      }),
      '/mnt/data/share/Rsdw',
    );
  });

  test('iOS and Android refuse to guess a sandbox path', () => {
    for (const platform of ['ios', 'android'] as const) {
      assert.throws(
        () => resolveVaultDirectory({ platform, env: {} }),
        /uygulama tarafindan verilmelidir/,
        `${platform} must demand a host-supplied container path`,
      );
    }
  });

  test('iOS: folder sits under the container the host passes in', () => {
    assert.equal(
      resolveVaultDirectory({
        platform: 'ios',
        baseDirectory: '/var/mobile/Containers/Data/Application/ABC/Library/Application Support',
      }),
      '/var/mobile/Containers/Data/Application/ABC/Library/Application Support/Rsdw',
    );
  });

  test('Android: folder sits under filesDir', () => {
    assert.equal(
      resolveVaultPath({ platform: 'android', baseDirectory: '/data/data/md.vgantt.app/files' }),
      '/data/data/md.vgantt.app/files/Rsdw/vault.xlsx',
    );
  });

  test('an explicit override wins on desktop, and is used as-is', () => {
    // A user who points at D:/Kasa expects the file there, not in D:/Kasa/Rsdw.
    assert.equal(
      resolveVaultDirectory({ platform: 'win32', baseDirectory: 'D:\\Kasa' }),
      'D:/Kasa',
    );
    assert.equal(
      resolveVaultDirectory({ platform: 'linux', env: { VGANTT_VAULT_DIR: '/mnt/veracrypt/kasa' } }),
      '/mnt/veracrypt/kasa',
    );
  });

  test('every platform uses the same folder name', () => {
    for (const policy of Object.values(VAULT_LOCATIONS)) {
      assert.equal(policy.folderName, VAULT_FOLDER);
    }
  });

  test('the sandboxed platforms declare a backup opt-out, the desktops do not', () => {
    assert.match(backupExclusionFor('ios'), /isExcludedFromBackupKey/);
    assert.match(backupExclusionFor('android'), /allowBackup="false"|dataExtractionRules/);

    // Desktop locations are already outside every default sync scope, so there
    // is nothing for the host to switch off.
    assert.equal(backupExclusionFor('win32'), null);
    assert.equal(backupExclusionFor('darwin'), null);
    assert.equal(backupExclusionFor('linux'), null);
  });

  test('every location documents why it was chosen', () => {
    for (const policy of Object.values(VAULT_LOCATIONS)) {
      assert.ok(policy.rationale.length > 40, `${policy.platform} needs a rationale`);
      assert.ok(policy.displayPath.includes(VAULT_FOLDER));
    }
  });
});
