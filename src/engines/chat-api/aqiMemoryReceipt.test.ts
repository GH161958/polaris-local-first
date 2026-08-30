import { describe, expect, it } from 'vitest';
import {
  decodeAqiMemoryReceiptHeader,
  readAqiMemoryReceiptHeader
} from './aqiMemoryReceipt';

function encode(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function receipt(identityState: string, memoryIds: string[]) {
  return {
    schema: 'aqi-memory-receipt/v0',
    authority: 'aqi-home-core',
    identityState,
    memoryRefs: memoryIds.map((memoryId) => ({ memoryId }))
  };
}

describe('Aqi Memory receipt decoder', () => {
  it('decodes a canonical resolved receipt with Unicode identity', () => {
    expect(decodeAqiMemoryReceiptHeader(
      encode(receipt('resolved', ['记忆-雪豹']))
    )).toEqual(receipt('resolved', ['记忆-雪豹']));
  });

  it.each([
    ['partial', ['memory-partial']],
    ['unavailable', []],
    ['no_evidence', []]
  ])('decodes %s identity state', (identityState, memoryIds) => {
    expect(decodeAqiMemoryReceiptHeader(
      encode(receipt(identityState, memoryIds))
    )).toEqual(receipt(identityState, memoryIds));
  });

  it('rejects corrupt and non-canonical base64url', () => {
    expect(() => decodeAqiMemoryReceiptHeader('***')).toThrow();
    expect(() => decodeAqiMemoryReceiptHeader(`${encode(receipt('no_evidence', []))}=`)).toThrow();
  });

  it('rejects wrong schema, authority, and unexpected fields', () => {
    const base = receipt('resolved', ['memory-1']);
    expect(() => decodeAqiMemoryReceiptHeader(encode({ ...base, schema: 'wrong' }))).toThrow();
    expect(() => decodeAqiMemoryReceiptHeader(encode({ ...base, authority: 'wrong' }))).toThrow();
    expect(() => decodeAqiMemoryReceiptHeader(encode({ ...base, provider: 'must-not-pass' }))).toThrow();
    expect(() => decodeAqiMemoryReceiptHeader(encode({
      ...base,
      memoryRefs: [{ memoryId: 'memory-1', score: 1 }]
    }))).toThrow();
  });

  it('rejects duplicate refs and contradictory state shapes', () => {
    expect(() => decodeAqiMemoryReceiptHeader(
      encode(receipt('resolved', ['memory-1', 'memory-1']))
    )).toThrow();
    expect(() => decodeAqiMemoryReceiptHeader(
      encode(receipt('resolved', []))
    )).toThrow();
  });

  it('treats absent or invalid response headers as optional metadata', () => {
    expect(readAqiMemoryReceiptHeader(new Response('{}'))).toBeUndefined();
    expect(readAqiMemoryReceiptHeader(new Response('{}', {
      headers: { 'X-Aqi-Memory-Receipt': 'corrupt' }
    }))).toBeUndefined();
  });
});
