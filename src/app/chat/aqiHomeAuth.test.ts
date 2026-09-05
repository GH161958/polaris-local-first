import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateAqiHome,
  notifyAqiHomeAuthRequired,
  subscribeAqiHomeAuthRequired
} from './aqiHomeAuth';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Aqi Home private session bootstrap', () => {
  it('posts the transient access key with credentials included', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{"ok":true}', { status: 200 }));

    await expect(authenticateAqiHome('test-access-key', fetchImpl)).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0];
    expect(String(input)).toMatch(/\/api\/auth\/session$/);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey: 'test-access-key' })
    });
  });

  it('does not make a request for an empty key', async () => {
    const fetchImpl = vi.fn();
    await expect(authenticateAqiHome('   ', fetchImpl)).resolves.toEqual({
      ok: false,
      errorType: 'access_key_required'
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps invalid credentials without exposing or retaining the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    await expect(authenticateAqiHome('wrong-test-key', fetchImpl)).resolves.toEqual({
      ok: false,
      errorType: 'invalid_access_key'
    });
  });

  it('notifies only current auth-required subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAqiHomeAuthRequired(listener);
    notifyAqiHomeAuthRequired();
    unsubscribe();
    notifyAqiHomeAuthRequired();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
