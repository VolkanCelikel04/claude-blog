export { Vault, VaultError, ENTRY_SHEET, META_SHEET, SCHEMA_VERSION } from './vault.ts';
export { NodeFsAdapter, defaultVaultPath, defaultVaultDirectory } from './adapters/node-fs.adapter.ts';
export {
  resolveVaultDirectory, resolveVaultPath, backupExclusionFor, currentPlatform,
  VAULT_LOCATIONS, VAULT_FOLDER, VAULT_FILE_NAME,
} from './vault-location.ts';
export type { VaultPlatform, VaultLocationPolicy } from './vault-location.ts';
export { MemoryAdapter } from './adapters/memory.adapter.ts';
export { FileSystemAccessAdapter } from './adapters/file-system-access.adapter.ts';
export { readWorkbook, writeWorkbook } from './xlsx/workbook.ts';
export { VaultDecryptionError } from './crypto.ts';
export type {
  VaultEntry, VaultEntryInput, VaultMeta, VaultFileAdapter, VaultOpenOptions,
} from './types.ts';
