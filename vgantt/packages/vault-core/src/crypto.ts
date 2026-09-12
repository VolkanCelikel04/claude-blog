/**
 * Field-level encryption for the local vault.
 *
 * Built entirely on WebCrypto (globalThis.crypto.subtle), which exists in
 * Node >= 20, Electron and every current browser. One implementation means a
 * vault file created by the desktop app opens unchanged in the browser
 * fallback, and there is no native module to compile or trust.
 *
 *   KDF    PBKDF2-HMAC-SHA256, 600k iterations (OWASP 2023 guidance)
 *   Cipher AES-256-GCM, 96-bit random IV per field, 128-bit tag
 *   AAD    "<entryId>:<field>" - binds a ciphertext to its cell, so a
 *          ciphertext copied into another row or column fails to decrypt
 *          instead of silently revealing a password somewhere it does not
 *          belong.
 */

export const ENC_PREFIX = 'enc:v1:';
export const DEFAULT_ITERATIONS = 600_000;
export const VERIFIER_AAD = 'vault:verifier';
export const VERIFIER_PLAINTEXT = 'vgantt-vault-ok';

export interface KdfParams {
  algorithm: 'pbkdf2-sha256';
  iterations: number;
  /** base64 */
  salt: string;
}

const subtle = (): SubtleCrypto => {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.subtle) {
    throw new Error(
      'WebCrypto bulunamadı. Node 20+ veya modern bir tarayıcı/Electron sürümü gerekir.',
    );
  }
  return webcrypto.subtle;
};

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function newKdfParams(iterations = DEFAULT_ITERATIONS): KdfParams {
  return {
    algorithm: 'pbkdf2-sha256',
    iterations,
    salt: toBase64(randomBytes(16)),
  };
}

export async function deriveKey(masterPassword: string, params: KdfParams): Promise<CryptoKey> {
  if (params.algorithm !== 'pbkdf2-sha256') {
    throw new Error(`Desteklenmeyen anahtar türetme algoritması: ${params.algorithm}`);
  }

  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(masterPassword.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(params.salt),
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,                       // non-extractable: the key cannot be read back out
    ['encrypt', 'decrypt'],
  );
}

export async function encryptField(key: CryptoKey, plaintext: string, aad: string): Promise<string> {
  if (plaintext === '') return '';

  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );

  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);

  return ENC_PREFIX + toBase64(payload);
}

export async function decryptField(key: CryptoKey, token: string, aad: string): Promise<string> {
  if (token === '') return '';
  if (!token.startsWith(ENC_PREFIX)) {
    // A plaintext vault (encryption explicitly disabled) or a cell the user
    // typed by hand in Excel. Return it as-is rather than failing the whole file.
    return token;
  }

  const payload = fromBase64(token.slice(ENC_PREFIX.length));
  const iv = payload.subarray(0, 12);
  const ciphertext = payload.subarray(12);

  try {
    const plaintext = await subtle().decrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new VaultDecryptionError(
      'Kayıt çözülemedi. Ana şifre yanlış olabilir ya da dosya değiştirilmiş olabilir.',
    );
  }
}

export class VaultDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultDecryptionError';
  }
}

/** Written once at creation; proves a master password before touching entries. */
export async function makeVerifier(key: CryptoKey): Promise<string> {
  return encryptField(key, VERIFIER_PLAINTEXT, VERIFIER_AAD);
}

export async function checkVerifier(key: CryptoKey, verifier: string): Promise<boolean> {
  try {
    return (await decryptField(key, verifier, VERIFIER_AAD)) === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

export function fieldAad(entryId: string, field: string): string {
  return `${entryId}:${field}`;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
