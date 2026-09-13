/**
 * Where the vault file lives, per platform.
 *
 * The interesting constraint is not "which folder is conventional" - it is
 * "which folder is NOT silently uploaded to someone's cloud". Every major
 * platform has a default location that a backup service copies off the device,
 * which would break module C's one rule. So each entry below records both the
 * directory AND the opt-out the host app has to perform.
 *
 * Node can resolve win32 / darwin / linux concretely. The iOS and Android
 * entries are policy, not paths: a sandboxed app is handed its own container at
 * runtime, so the native shell supplies the base directory and applies the
 * exclusion flag named here. Keeping all five in one table means the mobile
 * shells and the desktop shell cannot drift apart.
 */
export type VaultPlatform = 'win32' | 'darwin' | 'linux' | 'ios' | 'android';

export interface VaultLocationPolicy {
  platform: VaultPlatform;
  /** Human-readable location, for documentation and support. */
  displayPath: string;
  /**
   * How the base directory is obtained. 'resolved' = this module computes it;
   * 'host' = the native shell must pass it in (sandboxed app container).
   */
  resolution: 'resolved' | 'host';
  /** Folder created under the base directory. Same name everywhere. */
  folderName: string;
  /**
   * The cloud-sync opt-out the host MUST perform. Null when the location is
   * already outside every default sync scope.
   */
  backupExclusion: string | null;
  /** Why this directory and not the obvious one. */
  rationale: string;
}

export const VAULT_FOLDER = 'Rsdw';
export const VAULT_FILE_NAME = 'vault.xlsx';

export const VAULT_LOCATIONS: Readonly<Record<VaultPlatform, VaultLocationPolicy>> = {
  win32: {
    platform: 'win32',
    displayPath: 'C:\\Rsdw\\vault.xlsx',
    resolution: 'resolved',
    folderName: VAULT_FOLDER,
    backupExclusion: null,
    rationale:
      'Drive root, outside the user profile. OneDrive Known Folder Move redirects ' +
      'Desktop, Documents and Pictures into the cloud; C:\\Rsdw is not in that set, ' +
      'so the vault stays on the machine without any opt-out.',
  },

  darwin: {
    platform: 'darwin',
    displayPath: '~/Library/Application Support/Rsdw/vault.xlsx',
    resolution: 'resolved',
    folderName: VAULT_FOLDER,
    backupExclusion: null,
    rationale:
      'Apple\'s documented location for application data. Deliberately NOT ~/Documents: ' +
      'with iCloud Drive "Desktop & Documents" enabled - the default on a new Mac - ' +
      'anything there is uploaded to Apple. ~/Library/Application Support is outside ' +
      'iCloud Drive\'s scope. (Time Machine still copies it; that is a local backup the ' +
      'user controls, and the file is encrypted anyway.)',
  },

  linux: {
    platform: 'linux',
    displayPath: '$XDG_DATA_HOME/Rsdw/vault.xlsx  (default ~/.local/share/Rsdw)',
    resolution: 'resolved',
    folderName: VAULT_FOLDER,
    backupExclusion: null,
    rationale:
      'XDG Base Directory spec: user data, not config and not cache - a cache ' +
      'directory can be cleared by the system at any time. Not synced by default.',
  },

  ios: {
    platform: 'ios',
    displayPath: '<app container>/Library/Application Support/Rsdw/vault.xlsx',
    resolution: 'host',
    folderName: VAULT_FOLDER,
    backupExclusion:
      'Set URLResourceKey.isExcludedFromBackupKey = true on the Rsdw directory ' +
      'immediately after creating it.',
    rationale:
      'The app sandbox container. Documents/ would appear in the Files app but is ' +
      'backed up to iCloud by default, and so is Application Support - hence the ' +
      'explicit exclusion flag. Library/Caches would avoid backup but the OS may ' +
      'delete it under storage pressure, which is unacceptable for a vault.',
  },

  android: {
    platform: 'android',
    displayPath: 'Context.getFilesDir()/Rsdw/vault.xlsx  (/data/data/<pkg>/files/Rsdw)',
    resolution: 'host',
    folderName: VAULT_FOLDER,
    backupExclusion:
      'android:allowBackup="false" in the manifest, or a dataExtractionRules / ' +
      'fullBackupContent rule that excludes files/Rsdw from cloud and device-transfer backup.',
    rationale:
      'App-internal storage: unreadable by other apps without root, and removed on ' +
      'uninstall. NOT getExternalFilesDir(), which sits on shared storage. Android ' +
      'Auto Backup copies app data to Google Drive by default on Android 6+, so the ' +
      'exclusion is mandatory.',
  },
};

export interface ResolveOptions {
  /** Defaults to the current process platform. */
  platform?: VaultPlatform;
  /**
   * Base directory for sandboxed platforms, and an override anywhere else.
   * A user-configured path (settings, VGANTT_VAULT_DIR) arrives here.
   */
  baseDirectory?: string;
  /** Environment lookup, injectable for tests. */
  env?: Record<string, string | undefined>;
}

/** Normalises to forward slashes; Windows APIs accept them and it keeps paths comparable. */
function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function currentPlatform(): VaultPlatform {
  const platform = typeof process === 'undefined' ? 'linux' : process.platform;
  if (platform === 'win32' || platform === 'darwin') return platform;
  // react-native sets navigator.product; treat anything else as linux-like.
  return 'linux';
}

/**
 * The directory the vault file lives in.
 *
 * Throws for iOS and Android unless the host passes its container path, because
 * guessing a sandbox path would produce a file the app cannot actually write.
 */
export function resolveVaultDirectory(options: ResolveOptions = {}): string {
  const platform = options.platform ?? currentPlatform();
  const env = options.env ?? (typeof process === 'undefined' ? {} : process.env);
  const policy = VAULT_LOCATIONS[platform];

  // An explicit override always wins: some users keep the vault on an encrypted
  // volume or a removable drive, and that is a legitimate choice.
  const override = options.baseDirectory ?? env.VGANTT_VAULT_DIR;

  if (policy.resolution === 'host') {
    if (!override) {
      throw new Error(
        `${platform} icin kasa dizini uygulama tarafindan verilmelidir ` +
          `(${policy.displayPath}). baseDirectory parametresini gecin.`,
      );
    }
    return `${normalise(override)}/${policy.folderName}`;
  }

  if (override) {
    // On desktop the override is the directory itself, not a parent: a user who
    // types D:/Kasa expects the file in D:/Kasa, not D:/Kasa/Rsdw.
    return normalise(override);
  }

  switch (platform) {
    case 'win32': {
      // The drive letter is not always C: on machines with a relocated profile.
      const systemDrive = env.SystemDrive ? normalise(env.SystemDrive) : 'C:';
      return `${systemDrive}/${policy.folderName}`;
    }

    case 'darwin': {
      const home = env.HOME ?? env.USERPROFILE ?? '.';
      return `${normalise(home)}/Library/Application Support/${policy.folderName}`;
    }

    case 'linux':
    default: {
      const home = env.HOME ?? env.USERPROFILE ?? '.';
      const dataHome = env.XDG_DATA_HOME
        ? normalise(env.XDG_DATA_HOME)
        : `${normalise(home)}/.local/share`;
      return `${dataHome}/${policy.folderName}`;
    }
  }
}

export function resolveVaultPath(options: ResolveOptions & { fileName?: string } = {}): string {
  return `${resolveVaultDirectory(options)}/${options.fileName ?? VAULT_FILE_NAME}`;
}

/** What the host app must do after creating the directory, or null if nothing. */
export function backupExclusionFor(platform: VaultPlatform = currentPlatform()): string | null {
  return VAULT_LOCATIONS[platform].backupExclusion;
}
