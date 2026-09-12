import { contextBridge, ipcRenderer } from 'electron';

/**
 * The entire bridge between the web UI and the local vault.
 *
 * Every channel is listed explicitly - there is no generic "invoke(channel)"
 * escape hatch, so the renderer cannot reach an IPC handler that was not meant
 * for it. Note what is missing: no way to read an arbitrary file, no way to
 * obtain the master password back, no way to get a whole entry with its
 * password in one call.
 */
const vaultApi = {
  status: (path?: string) => ipcRenderer.invoke('vault:status', path),
  unlock: (masterPassword: string, path?: string) =>
    ipcRenderer.invoke('vault:unlock', { masterPassword, path }),
  lock: () => ipcRenderer.invoke('vault:lock'),

  list: () => ipcRenderer.invoke('vault:list'),
  search: (query: string) => ipcRenderer.invoke('vault:search', query),

  add: (input: unknown) => ipcRenderer.invoke('vault:add', input),
  update: (id: string, patch: unknown) => ipcRenderer.invoke('vault:update', { id, patch }),
  remove: (id: string) => ipcRenderer.invoke('vault:remove', id),

  /** Returns one password, only when the user explicitly asks to see it. */
  reveal: (id: string) => ipcRenderer.invoke('vault:reveal', id),
  /** Copies to the clipboard in the main process; the value never enters the page. */
  copyPassword: (id: string) => ipcRenderer.invoke('vault:copyPassword', id),

  changeMasterPassword: (current: string, next: string) =>
    ipcRenderer.invoke('vault:changeMasterPassword', { current, next }),
  backup: () => ipcRenderer.invoke('vault:backup'),

  /** Device label + entry count. This is all the server is ever told. */
  metadataForServer: () => ipcRenderer.invoke('vault:metadataForServer'),
};

contextBridge.exposeInMainWorld('vganttVault', vaultApi);
contextBridge.exposeInMainWorld('vganttDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,
});

export type VaultApi = typeof vaultApi;
