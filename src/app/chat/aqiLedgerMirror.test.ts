import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../types/domain';
import {
  authenticateAqiHome,
  subscribeAqiHomeAuthRequired
} from './aqiHomeAuth';
import { mirrorAqiVisibleUserBeforeRequest } from './aqiLedgerMirror';

const coreApi = { baseUrl: '/api', path: '/chat/completions' };
const visibleUser = [{
  id: 'message-1',
  role: 'user',
  content: 'synthetic visible message',
  timestamp: 1234
}] as ChatMessage[];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Aqi Ledger authenticated mirror', () => {
  it('mirrors with included credentials after session login', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);

    await expect(authenticateAqiHome('test-access-key')).resolves.toEqual({ ok: true });
    await mirrorAqiVisibleUserBeforeRequest({
      api: coreApi,
      conversationId: 'conversation-1',
      messages: visibleUser
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, mirrorInit] = fetchImpl.mock.calls[1];
    expect(mirrorInit).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(JSON.parse(String(mirrorInit?.body))).toMatchObject({
      sourceSystem: 'polaris',
      sourceConversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      role: 'user',
      content: 'synthetic visible message'
    });
    expect(String(mirrorInit?.body)).not.toContain('test-access-key');
  });

  it('reports auth-required on a 401 mirror response', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAqiHomeAuthRequired(listener);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"error":{"type":"unauthorized"}}',
      { status: 401 }
    )));

    await expect(mirrorAqiVisibleUserBeforeRequest({
      api: coreApi,
      conversationId: 'conversation-1',
      messages: visibleUser
    })).rejects.toThrow('Aqi Ledger mirror failed: HTTP 401');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
