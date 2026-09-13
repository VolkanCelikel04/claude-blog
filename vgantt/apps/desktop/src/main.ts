import { app, BrowserWindow, shell, session } from 'electron';
import { join } from 'node:path';
import { registerVaultHandlers, disposeVault } from './vault-ipc.js';

/**
 * Electron shell for Vgantt Suite.
 *
 * Hardened on purpose, because this process is the one with filesystem access
 * to the vault:
 *   - contextIsolation on, nodeIntegration off, sandboxed renderer
 *   - a preload script is the only bridge, exposing a fixed list of channels
 *   - navigation and window.open to anywhere but the app origin are blocked
 *   - a CSP that permits the API origin and nothing else
 */
// Packaged builds point at production; a dev run overrides both with the local
// Vite and Nest servers.
const PRODUCTION_ORIGIN = 'https://suite.vgantt.com';
const isDevelopment = !app.isPackaged;

const WEB_APP_URL =
  process.env.VGANTT_WEB_URL ?? (isDevelopment ? 'http://localhost:5173' : PRODUCTION_ORIGIN);
const API_ORIGIN =
  process.env.VGANTT_API_ORIGIN ?? (isDevelopment ? 'http://localhost:3000' : PRODUCTION_ORIGIN);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Vgantt Suite',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      // CommonJS on purpose: a sandboxed preload cannot be an ES module.
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // External links open in the user's browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    const allowed = new URL(WEB_APP_URL);
    if (target.origin !== allowed.origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void mainWindow.loadURL(WEB_APP_URL);

  if (isDevelopment) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            `connect-src 'self' ${API_ORIGIN}${isDevelopment ? " ws://localhost:5173" : ''}`,
            "img-src 'self' data:",
            `style-src 'self' 'unsafe-inline'`,
            `script-src 'self'${isDevelopment ? " 'unsafe-eval'" : ''}`,
            "object-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'none'",
          ].join('; '),
        ],
      },
    });
  });
}

app.whenReady().then(() => {
  applyContentSecurityPolicy();
  registerVaultHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', disposeVault);

// A second instance would fight over the vault file; keep exactly one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
