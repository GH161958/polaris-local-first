import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuiltRequest } from './chatApiTypes';
import { executeBuiltRequest } from './chatApiTransport';
import { createProviderRuntimeTestProvider } from '../provider-runtime/providerRuntimeFixtures';

function encodeReceipt(identityState: string, memoryIds: string[]) {
  const bytes = new TextEncoder().encode(JSON.stringify({
    schema: 'aqi-memory-receipt/v0',
    authority: 'aqi-home-core',
    identityState,
    memoryRefs: memoryIds.map((memoryId) => ({ memoryId }))
  }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createAqiApi() {
  return createProviderRuntimeTestProvider({
    baseUrl: '/api',
    path: '/chat/completions'
  });
}

function createAqiRequest(body: Record<string, unknown> = {}) {
  return {
    ...createNonStreamRequest(body),
    endpoint: '/api/chat/completions'
  };
}

const originalFetch = globalThis.fetch;
const nativeRuntime = vi.hoisted(() => ({
  nativePlatform: false,
  platform: 'web',
  available: true,
  execute: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativeRuntime.nativePlatform,
    getPlatform: () => nativeRuntime.platform
  }
}));

vi.mock('../../native/providerHttp', () => ({
  canUseNativeProviderHttp: () => nativeRuntime.available,
  executeNativeProviderHttpRequest: (...args: unknown[]) => nativeRuntime.execute(...args)
}));

function createNonStreamRequest(body: Record<string, unknown> = {}): BuiltRequest {
  return {
    endpoint: 'https://example.com/v1/chat/completions',
    headers: {},
    body: {
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: '整理旧对话' }],
      ...body
    },
    provider: 'openai-completions',
    compatibilityMode: 'standard'
  };
}

describe('executeBuiltRequest non-stream responses', () => {
  beforeEach(() => {
    nativeRuntime.nativePlatform = false;
    nativeRuntime.platform = 'web';
    nativeRuntime.available = true;
    nativeRuntime.execute.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('accepts plain text non-stream replies when no native tools were requested', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => (
      new Response('想起了一条可以保留的关系线索。', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    ));

    const reply = await executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest()
    });

    expect(reply.content).toBe('想起了一条可以保留的关系线索。');
    expect(reply.model).toBe('gpt-5-mini');
  });

  it('still rejects plain text when native tools were requested', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => (
      new Response('想起了一条可以保留的关系线索。', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    ));

    await expect(executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest({
        tools: [{
          type: 'function',
          function: {
            name: 'writeMemory',
            description: 'writes memory',
            parameters: { type: 'object' }
          }
        }]
      })
    })).rejects.toThrow('API 返回了无法解析的非 JSON 响应');
  });

  it('does not treat JSON-shaped text/plain payloads as assistant text', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => (
      new Response('{"unexpected":true}', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    ));

    await expect(executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest()
    })).rejects.toThrow();
  });

  it('uses the dedicated native bridge only for absolute provider endpoints', async () => {
    nativeRuntime.nativePlatform = true;
    nativeRuntime.platform = 'ios';
    globalThis.fetch = vi.fn<typeof fetch>();
    nativeRuntime.execute.mockImplementation(async (args) => {
      args.onResponse({ status: 200, contentType: 'application/json' });
      args.onTextChunk(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '原生网络已连通' } }]
      }));
      return { status: 200, contentType: 'application/json' };
    });

    const onChunk = vi.fn();
    const reply = await executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest(),
      onChunk
    });

    expect(reply.content).toBe('原生网络已连通');
    expect(nativeRuntime.execute).toHaveBeenCalledTimes(1);
    expect(nativeRuntime.execute.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://example.com/v1/chat/completions'
    });
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps app-internal endpoints on fetch instead of the provider bridge', async () => {
    nativeRuntime.nativePlatform = true;
    nativeRuntime.platform = 'android';
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '内部接口仍由应用网络负责' } }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const reply = await executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: {
        ...createNonStreamRequest(),
        endpoint: '/api/client-diagnostics'
      }
    });

    expect(reply.content).toBe('内部接口仍由应用网络负责');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/client-diagnostics', expect.any(Object));
    expect(nativeRuntime.execute).not.toHaveBeenCalled();
  });

  it('attaches a valid Aqi receipt without changing non-stream assistant content', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'exact non-stream text' } }]
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'X-Aqi-Memory-Receipt': encodeReceipt('resolved', ['memory-json'])
      }
    }));

    const reply = await executeBuiltRequest({
      api: createAqiApi(),
      request: createAqiRequest()
    });

    expect(reply.content).toBe('exact non-stream text');
    expect(reply.aqiMemoryReceipt).toEqual({
      schema: 'aqi-memory-receipt/v0',
      authority: 'aqi-home-core',
      identityState: 'resolved',
      memoryRefs: [{ memoryId: 'memory-json' }]
    });
  });

  it('attaches a valid Aqi receipt after streaming completes without changing text', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"stream "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"text"},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
      ''
    ].join('\n');
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(sse, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'X-Aqi-Memory-Receipt': encodeReceipt('partial', ['memory-stream'])
      }
    }));

    const reply = await executeBuiltRequest({
      api: createAqiApi(),
      request: createAqiRequest({ stream: true })
    });

    expect(reply.content).toBe('stream text');
    expect(reply.aqiMemoryReceipt?.memoryRefs).toEqual([{ memoryId: 'memory-stream' }]);
  });

  it('does not cross-attach consecutive Aqi response receipts', async () => {
    let call = 0;
    globalThis.fetch = vi.fn<typeof fetch>(async () => {
      call += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: `reply-${call}` } }]
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'X-Aqi-Memory-Receipt': encodeReceipt('resolved', [`memory-${call}`])
        }
      });
    });

    const first = await executeBuiltRequest({ api: createAqiApi(), request: createAqiRequest() });
    const second = await executeBuiltRequest({ api: createAqiApi(), request: createAqiRequest() });

    expect(first.aqiMemoryReceipt?.memoryRefs).toEqual([{ memoryId: 'memory-1' }]);
    expect(second.aqiMemoryReceipt?.memoryRefs).toEqual([{ memoryId: 'memory-2' }]);
  });

  it('ignores absent, corrupt, failed-response, and external-route receipt data', async () => {
    const replies = [
      new Response(JSON.stringify({ choices: [{ message: { content: 'absent' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }),
      new Response(JSON.stringify({ choices: [{ message: { content: 'corrupt' } }] }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'X-Aqi-Memory-Receipt': 'corrupt'
        }
      }),
      new Response(JSON.stringify({ choices: [{ message: { content: 'external' } }] }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'X-Aqi-Memory-Receipt': encodeReceipt('resolved', ['memory-external'])
        }
      })
    ];
    globalThis.fetch = vi.fn<typeof fetch>(async () => replies.shift() as Response);

    const absent = await executeBuiltRequest({ api: createAqiApi(), request: createAqiRequest() });
    const corrupt = await executeBuiltRequest({ api: createAqiApi(), request: createAqiRequest() });
    const external = await executeBuiltRequest({
      api: createProviderRuntimeTestProvider(),
      request: createNonStreamRequest()
    });

    expect(absent.aqiMemoryReceipt).toBeUndefined();
    expect(corrupt.aqiMemoryReceipt).toBeUndefined();
    expect(external.aqiMemoryReceipt).toBeUndefined();
    expect([absent.content, corrupt.content, external.content]).toEqual(['absent', 'corrupt', 'external']);
  });

  it('does not produce receipt state when assistant response parsing fails', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response('{bad-json', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'X-Aqi-Memory-Receipt': encodeReceipt('resolved', ['memory-orphan'])
      }
    }));

    await expect(executeBuiltRequest({
      api: createAqiApi(),
      request: createAqiRequest()
    })).rejects.toThrow();
  });
});
