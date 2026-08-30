import { describe, expect, it, vi } from 'vitest';
import type { AqiMemoryReceipt, ChatMessage } from '../../types/domain';
import {
  deserializeMessagePayload,
  serializeMessagePayload
} from '../../engines/localData/chatSqliteSerialization';
import {
  readAqiMemorySourceEvidenceForMessage,
  validateAqiMemorySourceEvidence
} from './aqiMemorySourceEvidence';

function receipt(
  identityState: AqiMemoryReceipt['identityState'],
  memoryIds: string[]
): AqiMemoryReceipt {
  return {
    schema: 'aqi-memory-receipt/v0',
    authority: 'aqi-home-core',
    identityState,
    memoryRefs: memoryIds.map((memoryId) => ({ memoryId }))
  };
}

function assistant(
  aqiMemoryReceipt?: AqiMemoryReceipt,
  patch: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id: 'assistant-exact',
    role: 'assistant',
    content: 'visible assistant content remains exact',
    timestamp: 1,
    aqiMemoryReceipt,
    ...patch
  };
}

function sourceRef(messageId = 'archive-message', membershipId?: string) {
  return {
    schema: 'aqi-source-ref/v0',
    authority: 'aqi-chat-ledger',
    kind: 'message',
    messageId,
    ...(membershipId ? { contextHint: { membershipId } } : {})
  };
}

function evidence(memoryId: string, sources: unknown[] = []) {
  return {
    schema: 'aqi-memory-source-evidence/v0',
    authority: 'aqi-home-core',
    memoryId,
    sources
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('readAqiMemorySourceEvidenceForMessage', () => {
  it('does not fetch for messages without canonical receipts', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const message = assistant(undefined, {
      memoryEvidence: {
        requestId: 'local-semantic-only',
        strategy: 'semantic_index',
        status: 'within_budget',
        items: []
      }
    });
    const before = structuredClone(message);

    await expect(readAqiMemorySourceEvidenceForMessage(message, { fetchImpl })).resolves.toEqual({
      assistantMessageId: 'assistant-exact',
      status: 'no_receipt',
      receiptIdentityState: null,
      memories: []
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(message).toEqual(before);
  });

  it.each([
    ['no_evidence', receipt('no_evidence', [])],
    ['unavailable', receipt('unavailable', [])]
  ] as const)('does not fabricate requests for %s receipts', async (identityState, value) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await readAqiMemorySourceEvidenceForMessage(assistant(value), { fetchImpl });

    expect(result).toEqual({
      assistantMessageId: 'assistant-exact',
      status: 'no_refs',
      receiptIdentityState: identityState,
      memories: []
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches one resolved ref by its exact encoded ID through the private session', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(evidence('记忆 雪豹')));
    const result = await readAqiMemorySourceEvidenceForMessage(
      assistant(receipt('resolved', ['记忆 雪豹'])),
      { fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/memory\/source-evidence\/%E8%AE%B0%E5%BF%86%20%E9%9B%AA%E8%B1%B9$/);
    expect(init).toEqual({
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    expect(JSON.stringify(init)).not.toMatch(/authorization|bearer|token/i);
    expect(result).toMatchObject({
      assistantMessageId: 'assistant-exact',
      status: 'complete',
      receiptIdentityState: 'resolved',
      memories: [{ memoryId: '记忆 雪豹', status: 'resolved' }]
    });
  });

  it('keeps partial and multiple Memory results individually associated and ordered', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const segments = String(input).split('/');
      const memoryId = decodeURIComponent(segments[segments.length - 1] ?? '');
      if (memoryId === 'memory-b') return new Response('unavailable', { status: 503 });
      return jsonResponse(evidence(memoryId));
    });
    const result = await readAqiMemorySourceEvidenceForMessage(
      assistant(receipt('partial', ['memory-a', 'memory-b', 'memory-c'])),
      { fetchImpl }
    );

    expect(result.status).toBe('partial_failure');
    expect(result.receiptIdentityState).toBe('partial');
    expect(result.memories).toEqual([
      { memoryId: 'memory-a', status: 'resolved', evidence: evidence('memory-a') },
      { memoryId: 'memory-b', status: 'failed', failure: 'server_error' },
      { memoryId: 'memory-c', status: 'resolved', evidence: evidence('memory-c') }
    ]);
  });

  it('accepts sources=[] as a successful no-link result', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(evidence('memory-empty')));
    const result = await readAqiMemorySourceEvidenceForMessage(
      assistant(receipt('resolved', ['memory-empty'])),
      { fetchImpl }
    );

    expect(result.memories).toEqual([{
      memoryId: 'memory-empty',
      status: 'resolved',
      evidence: evidence('memory-empty')
    }]);
  });

  it('preserves exact safe content and resolved lineage fields', async () => {
    const exactContent = '记录：阿栖能用花园之后';
    const source = {
      ref: sourceRef('archive-exact', 'membership-exact'),
      status: 'resolved',
      messageId: 'archive-exact',
      role: 'user',
      content: { content_type: 'text', parts: [exactContent] },
      selectedMembershipId: 'membership-exact',
      contextState: 'resolved',
      sourceConversationId: 'conversation-exact',
      onActivePath: true
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(evidence('memory-exact', [source])));
    const result = await readAqiMemorySourceEvidenceForMessage(
      assistant(receipt('resolved', ['memory-exact'])),
      { fetchImpl }
    );

    expect(result.memories[0]).toEqual({
      memoryId: 'memory-exact',
      status: 'resolved',
      evidence: evidence('memory-exact', [source])
    });
  });

  it('preserves membership_required without choosing a membership', () => {
    const source = {
      ref: sourceRef(),
      status: 'resolved',
      messageId: 'archive-message',
      contextState: 'membership_required',
      membershipCount: 2
    };
    const value = validateAqiMemorySourceEvidence(evidence('memory-required', [source]), 'memory-required');

    expect(value.sources).toEqual([source]);
    expect(value.sources[0]).not.toHaveProperty('content');
    expect(value.sources[0]).not.toHaveProperty('selectedMembershipId');
  });

  it('preserves membership_mismatch without fallback', () => {
    const source = {
      ref: sourceRef('archive-message', 'membership-wrong'),
      status: 'membership_mismatch'
    };
    const value = validateAqiMemorySourceEvidence(evidence('memory-mismatch', [source]), 'memory-mismatch');

    expect(value.sources).toEqual([source]);
    expect(value.sources[0]).not.toHaveProperty('content');
  });

  it('preserves context_missing without inventing lineage', () => {
    const source = {
      ref: sourceRef('archive-message', 'membership-selected'),
      status: 'resolved',
      messageId: 'archive-message',
      role: 'assistant',
      content: { content_type: 'code', text: 'const exact = true;' },
      selectedMembershipId: 'membership-selected',
      contextState: 'context_missing'
    };
    const value = validateAqiMemorySourceEvidence(evidence('memory-context', [source]), 'memory-context');

    expect(value.sources).toEqual([source]);
    expect(value.sources[0]).not.toHaveProperty('sourceConversationId');
    expect(value.sources[0]).not.toHaveProperty('onActivePath');
  });

  it.each([
    ['wrong schema', { ...evidence('memory-bad'), schema: 'wrong' }],
    ['wrong authority', { ...evidence('memory-bad'), authority: 'wrong' }],
    ['wrong Memory identity', evidence('different-memory')],
    ['private extra field', {
      ...evidence('memory-bad'),
      sources: [{ ref: sourceRef(), status: 'missing_target', rawDbPath: '/private/ledger.sqlite' }]
    }],
    ['invented context lineage', {
      ...evidence('memory-bad'),
      sources: [{
        ref: sourceRef('archive', 'membership'),
        status: 'resolved',
        messageId: 'archive',
        role: 'user',
        content: { content_type: 'text', parts: ['exact'] },
        selectedMembershipId: 'membership',
        contextState: 'context_missing',
        sourceConversationId: 'must-not-pass'
      }]
    }]
  ])('rejects malformed evidence safely: %s', async (_name, payload) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(payload));
    const result = await readAqiMemorySourceEvidenceForMessage(
      assistant(receipt('resolved', ['memory-bad'])),
      { fetchImpl }
    );

    expect(result).toMatchObject({
      status: 'failed',
      memories: [{ memoryId: 'memory-bad', status: 'failed', failure: 'invalid_response' }]
    });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'server_error'],
    [503, 'server_error'],
    [400, 'http_error']
  ] as const)('maps HTTP %i to a safe %s failure', async (status, failure) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('private upstream body', { status }));
    const result = await readAqiMemorySourceEvidenceForMessage(
      assistant(receipt('resolved', ['memory-http'])),
      { fetchImpl }
    );

    expect(result.memories).toEqual([{
      memoryId: 'memory-http',
      status: 'failed',
      failure
    }]);
  });

  it('maps network failure safely without throwing', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('private network details');
    });
    const result = await readAqiMemorySourceEvidenceForMessage(
      assistant(receipt('resolved', ['memory-network'])),
      { fetchImpl }
    );

    expect(result.memories).toEqual([{
      memoryId: 'memory-network',
      status: 'failed',
      failure: 'network'
    }]);
  });

  it('uses a receipt re-read from the normal SQLite message payload path', async () => {
    const original = assistant(receipt('resolved', ['memory-reloaded']));
    const payload = serializeMessagePayload(original, 'conversation-reloaded');
    const reloaded = deserializeMessagePayload(
      { payload_json: payload },
      'conversation-reloaded'
    );
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(evidence('memory-reloaded')));

    const result = await readAqiMemorySourceEvidenceForMessage(reloaded, { fetchImpl });

    expect(result).toMatchObject({
      assistantMessageId: 'assistant-exact',
      status: 'complete',
      memories: [{ memoryId: 'memory-reloaded', status: 'resolved' }]
    });
    expect(reloaded.content).toBe('visible assistant content remains exact');
  });
});
