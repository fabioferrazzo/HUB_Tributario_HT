import { base64Of, bytesFromBase64, concatBytes, hexOf, toUint8Array, uint32LE, utf8Decode, utf8Encode } from './bytes.js';

export const ENCRYPTED_HTAF_MAGIC = utf8Encode('HTAFENC1');
export const DEFAULT_PBKDF2_ITERATIONS = 310000;

function subtle() {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error('Web Crypto API is not available');
  return value;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure random generator is not available');
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export async function sha256Bytes(input) {
  return new Uint8Array(await subtle().digest('SHA-256', toUint8Array(input)));
}

export async function sha256Hex(input) {
  return hexOf(await sha256Bytes(input));
}

async function deriveAesKey(password, salt, iterations, usages) {
  if (typeof password !== 'string' || password.length < 1) throw new Error('A password is required');
  const material = await subtle().importKey('raw', utf8Encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    {name: 'PBKDF2', hash: 'SHA-256', salt, iterations},
    material,
    {name: 'AES-GCM', length: 256},
    false,
    usages,
  );
}

export function isEncryptedHtaf(input) {
  const bytes = toUint8Array(input);
  if (bytes.byteLength < ENCRYPTED_HTAF_MAGIC.byteLength + 4) return false;
  return ENCRYPTED_HTAF_MAGIC.every((byte, index) => bytes[index] === byte);
}

export async function encryptHtafPayload(plainBytes, password, options = {}) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('A backup password must contain at least 8 characters');
  const input = toUint8Array(plainBytes);
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 2000000) throw new Error('Invalid PBKDF2 iteration count');
  const salt = options.salt ? toUint8Array(options.salt) : randomBytes(16);
  const iv = options.iv ? toUint8Array(options.iv) : randomBytes(12);
  if (salt.byteLength < 16) throw new Error('Salt must contain at least 16 bytes');
  if (iv.byteLength !== 12) throw new Error('AES-GCM IV must contain 12 bytes');
  const plaintextSha256 = await sha256Hex(input);
  const header = {
    format: 'HTAF_ENCRYPTED',
    version: 1,
    createdAt: options.createdAt || new Date().toISOString(),
    kdf: {name: 'PBKDF2', hash: 'SHA-256', iterations, salt: base64Of(salt)},
    cipher: {name: 'AES-GCM', length: 256, iv: base64Of(iv)},
    plaintextSha256,
  };
  const headerBytes = utf8Encode(JSON.stringify(header));
  const key = await deriveAesKey(password, salt, iterations, ['encrypt']);
  const encrypted = new Uint8Array(await subtle().encrypt({name: 'AES-GCM', iv, additionalData: headerBytes, tagLength: 128}, key, input));
  return concatBytes(ENCRYPTED_HTAF_MAGIC, uint32LE(headerBytes.byteLength), headerBytes, encrypted);
}

export async function decryptHtafPayload(encryptedBytes, password, options = {}) {
  const input = toUint8Array(encryptedBytes);
  if (!isEncryptedHtaf(input)) throw new Error('The file is not an encrypted HTAF archive');
  const maxHeaderBytes = options.maxHeaderBytes ?? 64 * 1024;
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const headerLength = view.getUint32(ENCRYPTED_HTAF_MAGIC.byteLength, true);
  const headerOffset = ENCRYPTED_HTAF_MAGIC.byteLength + 4;
  if (headerLength < 2 || headerLength > maxHeaderBytes || headerOffset + headerLength >= input.byteLength) throw new Error('Invalid encrypted HTAF header');
  const headerBytes = input.slice(headerOffset, headerOffset + headerLength);
  let header;
  try { header = JSON.parse(utf8Decode(headerBytes)); } catch { throw new Error('Invalid encrypted HTAF header JSON'); }
  if (header.format !== 'HTAF_ENCRYPTED' || header.version !== 1) throw new Error('Unsupported encrypted HTAF version');
  if (header.kdf?.name !== 'PBKDF2' || header.kdf?.hash !== 'SHA-256') throw new Error('Unsupported HTAF key derivation method');
  if (header.cipher?.name !== 'AES-GCM' || header.cipher?.length !== 256) throw new Error('Unsupported HTAF cipher');
  const iterations = Number(header.kdf.iterations);
  if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 2000000) throw new Error('Invalid encrypted HTAF iteration count');
  const salt = bytesFromBase64(header.kdf.salt);
  const iv = bytesFromBase64(header.cipher.iv);
  if (salt.byteLength < 16 || iv.byteLength !== 12) throw new Error('Invalid encrypted HTAF cryptographic parameters');
  const ciphertext = input.slice(headerOffset + headerLength);
  const key = await deriveAesKey(password, salt, iterations, ['decrypt']);
  let plain;
  try {
    plain = new Uint8Array(await subtle().decrypt({name: 'AES-GCM', iv, additionalData: headerBytes, tagLength: 128}, key, ciphertext));
  } catch {
    throw new Error('Incorrect password or corrupted encrypted HTAF file');
  }
  const hash = await sha256Hex(plain);
  if (hash !== header.plaintextSha256) throw new Error('Encrypted HTAF plaintext hash mismatch');
  return {bytes: plain, header};
}
