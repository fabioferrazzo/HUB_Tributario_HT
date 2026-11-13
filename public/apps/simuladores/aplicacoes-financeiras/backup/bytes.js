const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

export function utf8Encode(value) {
  return encoder.encode(String(value));
}

export function utf8Decode(bytes) {
  return decoder.decode(toUint8Array(bytes));
}

export function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Expected ArrayBuffer or typed array');
}

export async function bytesOf(value) {
  if (typeof value === 'string') return utf8Encode(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return toUint8Array(value);
}

export function concatBytes(...parts) {
  const arrays = parts.filter(Boolean).map(toUint8Array);
  const total = arrays.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of arrays) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function hexOf(bytes) {
  return [...toUint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function bytesFromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || !/^[0-9a-f]*$/i.test(hex)) throw new TypeError('Invalid hexadecimal string');
  const output = new Uint8Array(hex.length / 2);
  for (let i = 0; i < output.length; i += 1) output[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return output;
}

export function base64Of(bytes) {
  const value = toUint8Array(bytes);
  if (typeof Buffer !== 'undefined') return Buffer.from(value).toString('base64');
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < value.length; i += step) binary += String.fromCharCode(...value.subarray(i, i + step));
  return btoa(binary);
}

export function bytesFromBase64(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid Base64 value');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
  return output;
}

export function uint32LE(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

export function stableStringify(value, space = 2) {
  const seen = new WeakSet();
  const normalize = input => {
    if (input === null || typeof input !== 'object') return input;
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(normalize);
    if (seen.has(input)) throw new TypeError('Cannot stringify circular data');
    seen.add(input);
    const output = {};
    for (const key of Object.keys(input).sort()) {
      const normalized = normalize(input[key]);
      if (normalized !== undefined) output[key] = normalized;
    }
    seen.delete(input);
    return output;
  };
  return JSON.stringify(normalize(value), null, space);
}

export function safeArchivePath(path) {
  const value = String(path).replaceAll('\\', '/');
  if (!value || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) throw new Error(`Unsafe archive path: ${path}`);
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe archive path: ${path}`);
  if (value.includes('\0')) throw new Error('Archive path contains a null byte');
  return value;
}

export function safeFileName(value, fallback = 'documento.bin') {
  const normalized = String(value || fallback).normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 180);
}
