import { bytesOf, concatBytes, safeArchivePath, toUint8Array, utf8Decode, utf8Encode } from './bytes.js';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MAX_EOCD_SEARCH = 0xffff + 22;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(input) {
  const bytes = toUint8Array(input);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.valueOf()) ? date : new Date();
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);
  return {
    time: ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f),
  };
}

function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function readU16(view, offset) { return view.getUint16(offset, true); }
function readU32(view, offset) { return view.getUint32(offset, true); }

export async function createZip(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('ZIP entries are required');
  const maxEntries = options.maxEntries ?? 10000;
  const maxTotalBytes = options.maxTotalBytes ?? 1024 * 1024 * 1024;
  if (entries.length > maxEntries) throw new Error(`ZIP entry limit exceeded (${maxEntries})`);

  const seen = new Set();
  const normalized = [];
  let totalDataBytes = 0;
  for (const entry of entries) {
    const name = safeArchivePath(entry.name);
    if (seen.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    seen.add(name);
    const data = await bytesOf(entry.data);
    totalDataBytes += data.byteLength;
    if (totalDataBytes > maxTotalBytes) throw new Error('ZIP content exceeds the configured size limit');
    normalized.push({name, nameBytes: utf8Encode(name), data, crc: crc32(data), modifiedAt: entry.modifiedAt || options.modifiedAt || new Date()});
  }
  normalized.sort((a, b) => a.name.localeCompare(b.name));

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of normalized) {
    if (entry.data.byteLength > 0xffffffff) throw new Error(`ZIP64 is not supported: ${entry.name}`);
    const stamp = dosDateTime(entry.modifiedAt);
    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    writeU32(localView, 0, LOCAL_FILE_HEADER);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, UTF8_FLAG);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, stamp.time);
    writeU16(localView, 12, stamp.date);
    writeU32(localView, 14, entry.crc);
    writeU32(localView, 18, entry.data.byteLength);
    writeU32(localView, 22, entry.data.byteLength);
    writeU16(localView, 26, entry.nameBytes.byteLength);
    writeU16(localView, 28, 0);
    localParts.push(localHeader, entry.nameBytes, entry.data);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    writeU32(centralView, 0, CENTRAL_FILE_HEADER);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, UTF8_FLAG);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, stamp.time);
    writeU16(centralView, 14, stamp.date);
    writeU32(centralView, 16, entry.crc);
    writeU32(centralView, 20, entry.data.byteLength);
    writeU32(centralView, 24, entry.data.byteLength);
    writeU16(centralView, 28, entry.nameBytes.byteLength);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, localOffset);
    centralParts.push(centralHeader, entry.nameBytes);
    localOffset += localHeader.byteLength + entry.nameBytes.byteLength + entry.data.byteLength;
  }

  const centralDirectory = concatBytes(...centralParts);
  if (localOffset > 0xffffffff || centralDirectory.byteLength > 0xffffffff) throw new Error('ZIP64 is not supported');
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeU32(eocdView, 0, END_OF_CENTRAL_DIRECTORY);
  writeU16(eocdView, 4, 0);
  writeU16(eocdView, 6, 0);
  writeU16(eocdView, 8, normalized.length);
  writeU16(eocdView, 10, normalized.length);
  writeU32(eocdView, 12, centralDirectory.byteLength);
  writeU32(eocdView, 16, localOffset);
  writeU16(eocdView, 20, 0);
  return concatBytes(...localParts, centralDirectory, eocd);
}

function findEocd(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lower = Math.max(0, bytes.byteLength - MAX_EOCD_SEARCH);
  for (let offset = bytes.byteLength - 22; offset >= lower; offset -= 1) {
    if (readU32(view, offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error('Invalid ZIP: central directory footer not found');
}

export function parseZip(input, options = {}) {
  const bytes = toUint8Array(input);
  const maxEntries = options.maxEntries ?? 10000;
  const maxTotalBytes = options.maxTotalBytes ?? 1024 * 1024 * 1024;
  const maxEntryBytes = options.maxEntryBytes ?? 100 * 1024 * 1024;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocd(bytes);
  const disk = readU16(view, eocdOffset + 4);
  const centralDisk = readU16(view, eocdOffset + 6);
  const countOnDisk = readU16(view, eocdOffset + 8);
  const entryCount = readU16(view, eocdOffset + 10);
  const centralSize = readU32(view, eocdOffset + 12);
  const centralOffset = readU32(view, eocdOffset + 16);
  const commentLength = readU16(view, eocdOffset + 20);
  if (disk !== 0 || centralDisk !== 0 || countOnDisk !== entryCount) throw new Error('Multi-disk ZIP archives are not supported');
  if (entryCount > maxEntries) throw new Error(`ZIP entry limit exceeded (${maxEntries})`);
  if (eocdOffset + 22 + commentLength > bytes.byteLength) throw new Error('Invalid ZIP footer');
  if (centralOffset + centralSize > eocdOffset) throw new Error('Invalid ZIP central directory bounds');

  const files = new Map();
  const metadata = [];
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > bytes.byteLength || readU32(view, cursor) !== CENTRAL_FILE_HEADER) throw new Error('Invalid ZIP central directory entry');
    const flags = readU16(view, cursor + 8);
    const method = readU16(view, cursor + 10);
    const expectedCrc = readU32(view, cursor + 16);
    const compressedSize = readU32(view, cursor + 20);
    const uncompressedSize = readU32(view, cursor + 24);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLengthEntry = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLengthEntry;
    if (end > bytes.byteLength) throw new Error('Invalid ZIP central directory entry bounds');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeArchivePath(utf8Decode(nameBytes));
    if (files.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    if (flags & 0x0001) throw new Error('Encrypted ZIP entries are not supported');
    if (method !== 0) throw new Error(`Compressed ZIP entry is not supported: ${name}`);
    if (compressedSize !== uncompressedSize) throw new Error(`Invalid stored ZIP entry size: ${name}`);
    if (uncompressedSize > maxEntryBytes) throw new Error(`ZIP entry exceeds the configured limit: ${name}`);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotalBytes) throw new Error('ZIP content exceeds the configured total size limit');

    if (localOffset + 30 > bytes.byteLength || readU32(view, localOffset) !== LOCAL_FILE_HEADER) throw new Error(`Invalid ZIP local header: ${name}`);
    const localFlags = readU16(view, localOffset + 6);
    const localMethod = readU16(view, localOffset + 8);
    const localNameLength = readU16(view, localOffset + 26);
    const localExtraLength = readU16(view, localOffset + 28);
    if (localFlags !== flags || localMethod !== method) throw new Error(`ZIP header mismatch: ${name}`);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > bytes.byteLength) throw new Error(`ZIP entry exceeds archive bounds: ${name}`);
    const data = bytes.slice(dataOffset, dataEnd);
    const actualCrc = crc32(data);
    if (actualCrc !== expectedCrc) throw new Error(`ZIP integrity error (CRC32): ${name}`);
    files.set(name, data);
    metadata.push({name, size: uncompressedSize, crc32: expectedCrc.toString(16).padStart(8, '0')});
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('ZIP central directory size mismatch');
  return {files, metadata, entryCount, totalUncompressedBytes: totalUncompressed};
}
