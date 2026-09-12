/**
 * Minimal ZIP container (store + deflate), enough for the OOXML parts of an
 * .xlsx workbook.
 *
 * Why hand-rolled instead of a library: this file is the only thing standing
 * between a user's plaintext passwords and disk. Every dependency added here is
 * third-party code with access to that plaintext, and a supply-chain incident in
 * any of them is an incident in the vault. The ZIP and SpreadsheetML subsets we
 * need are small and stable, so we own them.
 */
import { deflateRawSync, inflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';

export interface ZipEntry {
  path: string;
  data: Buffer;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** node:zlib gained crc32 in 20.15 / 22.2; keep a fallback for older runtimes. */
const crc32: (data: Buffer) => number =
  typeof zlibCrc32 === 'function'
    ? (data) => zlibCrc32(data) >>> 0
    : (data) => fallbackCrc32(data);

let crcTable: Uint32Array | undefined;
function fallbackCrc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Fixed DOS timestamp keeps archives byte-reproducible for a given input. */
const DOS_TIME = 0;
const DOS_DATE = 0x2821; // 2000-01-01

export function zipWrite(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const raw = entry.data;
    const deflated = deflateRawSync(raw, { level: 9 });

    // Tiny parts can grow when deflated; store those verbatim.
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 38);  // external attributes
    central.writeUInt32LE(offset, 42);

    centrals.push(central, name);
    offset += local.length + name.length + payload.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

export function zipRead(buffer: Buffer): Map<string, Buffer> {
  const eocdOffset = findEocd(buffer);
  if (eocdOffset < 0) throw new Error('Geçersiz .xlsx dosyası: ZIP sonu bulunamadı.');

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);

  const result = new Map<string, Buffer>();

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIG) {
      throw new Error('Geçersiz .xlsx dosyası: merkezi dizin bozuk.');
    }

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);

    result.set(name, method === METHOD_DEFLATE ? inflateRawSync(payload) : Buffer.from(payload));

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return result;
}

function findEocd(buffer: Buffer): number {
  // The comment field is variable length, so scan backwards for the signature.
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= minimum; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}
