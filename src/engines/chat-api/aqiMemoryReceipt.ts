import type { AqiMemoryReceipt, ProviderProfile } from '../../types/domain';

export const AQI_MEMORY_RECEIPT_HEADER = 'X-Aqi-Memory-Receipt';

const RECEIPT_SCHEMA = 'aqi-memory-receipt/v0';
const RECEIPT_AUTHORITY = 'aqi-home-core';
const RECEIPT_KEYS = new Set(['schema', 'authority', 'identityState', 'memoryRefs']);
const REF_KEYS = new Set(['memoryId']);
const IDENTITY_STATES = new Set([
  'resolved',
  'partial',
  'unavailable',
  'no_evidence'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function normalizeMemoryId(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > 256
    || normalized === '.'
    || normalized === '..'
    || normalized.includes('/')
    || normalized.includes('\\')
    || [...normalized].some((character) => /\p{Cc}/u.test(character))
  ) {
    return null;
  }
  return normalized;
}

function decodeCanonicalBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new TypeError('Aqi Memory receipt header is invalid');
  }
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`;
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new TypeError('Aqi Memory receipt header is invalid');
  }
  const canonical = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (canonical !== value) {
    throw new TypeError('Aqi Memory receipt header is invalid');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function validateAqiMemoryReceipt(value: unknown): AqiMemoryReceipt {
  if (!isRecord(value) || !hasExactKeys(value, RECEIPT_KEYS)) {
    throw new TypeError('Aqi Memory receipt contract is invalid');
  }
  if (
    value.schema !== RECEIPT_SCHEMA
    || value.authority !== RECEIPT_AUTHORITY
    || typeof value.identityState !== 'string'
    || !IDENTITY_STATES.has(value.identityState)
    || !Array.isArray(value.memoryRefs)
  ) {
    throw new TypeError('Aqi Memory receipt contract is invalid');
  }

  const seen = new Set<string>();
  const memoryRefs = value.memoryRefs.map((ref) => {
    if (!isRecord(ref) || !hasExactKeys(ref, REF_KEYS)) {
      throw new TypeError('Aqi Memory receipt ref is invalid');
    }
    const memoryId = normalizeMemoryId(ref.memoryId);
    if (!memoryId || seen.has(memoryId)) {
      throw new TypeError('Aqi Memory receipt ref is invalid');
    }
    seen.add(memoryId);
    return Object.freeze({ memoryId });
  });

  const hasRefs = memoryRefs.length > 0;
  if (
    ((value.identityState === 'resolved' || value.identityState === 'partial') && !hasRefs)
    || ((value.identityState === 'unavailable' || value.identityState === 'no_evidence') && hasRefs)
  ) {
    throw new TypeError('Aqi Memory receipt state does not match its refs');
  }

  return Object.freeze({
    schema: RECEIPT_SCHEMA,
    authority: RECEIPT_AUTHORITY,
    identityState: value.identityState as AqiMemoryReceipt['identityState'],
    memoryRefs: Object.freeze(memoryRefs)
  });
}

export function decodeAqiMemoryReceiptHeader(value: string): AqiMemoryReceipt {
  try {
    const bytes = decodeCanonicalBase64Url(value);
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return validateAqiMemoryReceipt(JSON.parse(json));
  } catch {
    throw new TypeError('Aqi Memory receipt header is invalid');
  }
}

export function readAqiMemoryReceiptHeader(response: Response): AqiMemoryReceipt | undefined {
  const header = response.headers.get(AQI_MEMORY_RECEIPT_HEADER);
  if (!header) return undefined;
  try {
    return decodeAqiMemoryReceiptHeader(header);
  } catch {
    return undefined;
  }
}

export function isAqiHomeMemoryReceiptRoute(
  api: Pick<ProviderProfile, 'baseUrl' | 'path'>
) {
  const baseUrl = api.baseUrl.trim().replace(/\/+$/, '');
  const path = api.path.trim().startsWith('/') ? api.path.trim() : `/${api.path.trim()}`;
  return baseUrl === '/api' && path === '/chat/completions';
}
