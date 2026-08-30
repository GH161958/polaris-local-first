import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AqiMemoryReceipt, ChatMessage } from '../../../../types/domain';
import type {
  AqiMemorySourceEvidenceForMessageResult,
  AqiMemorySourceEvidenceSource
} from '../../../../app/chat/aqiMemorySourceEvidence';
import {
  hasAqiMemorySourceEvidenceAction,
  loadAqiMemorySourceEvidence,
  MessageAqiMemoryEvidence,
  MessageAqiMemoryEvidenceView
} from './MessageAqiMemoryEvidence';
import { MessageRow } from './MessageRow';

function receipt(memoryIds: string[]): AqiMemoryReceipt {
  return {
    schema: 'aqi-memory-receipt/v0',
    authority: 'aqi-home-core',
    identityState: 'resolved',
    memoryRefs: memoryIds.map((memoryId) => ({ memoryId }))
  };
}

function assistant(patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-exact',
    role: 'assistant',
    content: 'assistant body remains unchanged',
    timestamp: 1,
    ...patch
  };
}

function sourceRef(messageId = 'source-message') {
  return {
    schema: 'aqi-source-ref/v0' as const,
    authority: 'aqi-chat-ledger' as const,
    kind: 'message' as const,
    messageId
  };
}

function result(memories: AqiMemorySourceEvidenceForMessageResult['memories']): AqiMemorySourceEvidenceForMessageResult {
  return {
    assistantMessageId: 'assistant-exact',
    status: memories.some((memory) => memory.status === 'failed') ? 'partial_failure' : 'complete',
    receiptIdentityState: 'resolved',
    memories
  };
}

function resolvedMemory(memoryId: string, sources: AqiMemorySourceEvidenceSource[]) {
  return {
    memoryId,
    status: 'resolved' as const,
    evidence: {
      schema: 'aqi-memory-source-evidence/v0' as const,
      authority: 'aqi-home-core' as const,
      memoryId,
      sources
    }
  };
}

function renderMessageRow(message: ChatMessage) {
  return renderToStaticMarkup(
    <MessageRow
      message={message}
      fallbackAssistantName="Polaris"
      assistantAvatarUrl={null}
      assistantAvatarIconId={null}
      assistantAvatarShape="rounded"
      assistantAvatarSize="medium"
      assistantSigilSeed={null}
      showChatAvatars={false}
      showThinking={false}
      state={{
        editing: null,
        isFocused: false,
        lifecycle: 'rest',
        isThinkingCollapsed: false,
        isCodeExpanded: false,
        canEdit: false,
        canEditAssistant: false,
        canRetry: false,
        codeCardActionMode: 'hidden',
        codeCardProgress: null,
        messageCycleIndex: null
      }}
      actions={{
        removeEditingAttachment: () => {},
        updateEditingDraft: () => {},
        commitEdit: async () => {},
        cancelEdit: () => {},
        toggleThinkingCollapsed: () => {},
        openThinkingSummary: () => {},
        saveImageAttachment: () => {},
        toggleCodeExpanded: () => {},
        applyCustomCss: () => {},
        codeCardAction: () => {},
        retry: async () => {},
        editMessage: () => {},
        editAssistantMessage: () => {},
        cacheAssistantSpeech: () => {},
        forkFromMessage: () => {},
        applyToolPreview: () => {},
        saveToolPreview: () => {},
        rollbackToolPreview: () => {},
        openToolbox: () => {},
        openCodeCard: () => {},
        runCodeCard: () => {},
        setCommandStatus: () => {}
      }}
      userAvatarUrl={null}
      userAvatarIconId={null}
      userAvatarShape="circle"
      userAvatarSize="medium"
      codeCardsById={{}}
    />
  );
}

function renderLoaded(value: AqiMemorySourceEvidenceForMessageResult) {
  return renderToStaticMarkup(
    <MessageAqiMemoryEvidenceView state={{ status: 'loaded', result: value }} onRead={() => {}} />
  );
}

describe('MessageAqiMemoryEvidence', () => {
  it('hides the action without a canonical receipt, for semantic-only evidence, and for zero refs', () => {
    const semanticOnly = assistant({
      memoryEvidence: {
        requestId: 'semantic-only',
        strategy: 'semantic_index',
        status: 'within_budget',
        items: []
      }
    });
    expect(hasAqiMemorySourceEvidenceAction(assistant())).toBe(false);
    expect(hasAqiMemorySourceEvidenceAction(semanticOnly)).toBe(false);
    expect(hasAqiMemorySourceEvidenceAction(assistant({
      aqiMemoryReceipt: { ...receipt([]), identityState: 'no_evidence' }
    }))).toBe(false);
  });

  it('shows the explicit action only for an applicable assistant receipt', () => {
    const message = assistant({ aqiMemoryReceipt: receipt(['memory-1']) });
    const reader = vi.fn();
    const html = renderToStaticMarkup(<MessageAqiMemoryEvidence message={message} reader={reader} />);

    expect(html).toContain('查看当时原话');
    expect(reader).not.toHaveBeenCalled();
    expect(hasAqiMemorySourceEvidenceAction({ ...message, role: 'user' })).toBe(false);
  });

  it('keeps ordinary and direct external-provider assistant rendering unchanged', () => {
    const ordinary = assistant();
    const external = assistant({ providerId: 'external-provider', providerName: 'External' });

    for (const message of [ordinary, external]) {
      const html = renderMessageRow(message);
      expect(html).toContain('assistant body remains unchanged');
      expect(html).not.toContain('查看当时原话');
    }
  });

  it('attaches the action to the exact assistant row without changing its visible content', () => {
    const html = renderMessageRow(assistant({ aqiMemoryReceipt: receipt(['memory-1']) }));

    expect(html).toContain('data-message-id="assistant-exact"');
    expect(html).toContain('assistant body remains unchanged');
    expect(html).toContain('查看当时原话');
  });

  it('keeps Polaris semantic evidence on its existing independent UI path', () => {
    const html = renderMessageRow(assistant({
      memoryEvidence: {
        requestId: 'semantic-only',
        strategy: 'semantic_index',
        status: 'within_budget',
        items: [{
          id: 'semantic-item',
          kind: 'vector_match',
          label: '现有语义证据',
          sourceConversationId: 'conversation-local',
          sourceMessageIds: ['message-local'],
          textExcerpt: '保持原有 semantic memoryEvidence 展示。',
          estimatedTokens: 8,
          charCount: 24,
          score: 0.8
        }]
      }
    }));

    expect(html).toContain('更多回答操作');
    expect(html).not.toContain('查看当时原话');
  });

  it('passes the exact message to the Phase E reader without mutation', async () => {
    const message = assistant({ aqiMemoryReceipt: receipt(['memory-1']) });
    const before = structuredClone(message);
    const expected = result([resolvedMemory('memory-1', [])]);
    const reader = vi.fn(async () => expected);

    await expect(loadAqiMemorySourceEvidence(message, reader)).resolves.toBe(expected);
    expect(reader).toHaveBeenCalledWith(message);
    expect(message).toEqual(before);
  });

  it('renders the local loading state', () => {
    const html = renderToStaticMarkup(
      <MessageAqiMemoryEvidenceView state={{ status: 'loading' }} onRead={() => {}} />
    );
    expect(html).toContain('正在读取…');
    expect(html).toContain('disabled');
  });

  it('renders exact safe text without interpreting markup', () => {
    const exact = '<script>not html</script>\n原样保留';
    const html = renderLoaded(result([resolvedMemory('memory-1', [{
      ref: sourceRef(),
      status: 'resolved',
      messageId: 'source-message',
      role: 'user',
      content: { content_type: 'text', parts: [exact] },
      selectedMembershipId: 'membership-1',
      contextState: 'resolved',
      sourceConversationId: 'conversation-1',
      onActivePath: true
    }])]));

    expect(html).toContain('&lt;script&gt;not html&lt;/script&gt;\n原样保留');
    expect(html).not.toContain('<script>');
  });

  it('renders sources=[] as an explicit no-link result', () => {
    expect(renderLoaded(result([resolvedMemory('memory-empty', [])]))).toContain('暂无原话链接');
  });

  it('does not fabricate content for membership_required', () => {
    const html = renderLoaded(result([resolvedMemory('memory-required', [{
      ref: sourceRef(),
      status: 'resolved',
      messageId: 'source-message',
      contextState: 'membership_required',
      membershipCount: 2
    }])]));
    expect(html).toContain('有多个可能的原话上下文，暂未自动选择。');
    expect(html).not.toContain('message-aqi-source-role');
  });

  it('shows exact content for context_missing without lineage fields', () => {
    const html = renderLoaded(result([resolvedMemory('memory-context', [{
      ref: sourceRef(),
      status: 'resolved',
      messageId: 'source-message',
      role: 'assistant',
      content: { content_type: 'code', text: 'const exact = true;' },
      selectedMembershipId: 'membership-1',
      contextState: 'context_missing'
    }])]));
    expect(html).toContain('const exact = true;');
    expect(html).toContain('暂时无法读取周边上下文。');
    expect(html).not.toContain('sourceConversationId');
    expect(html).not.toContain('onActivePath');
  });

  it('maps mismatch and failed reads to a safe unavailable message', () => {
    const html = renderLoaded(result([
      resolvedMemory('memory-mismatch', [{ ref: sourceRef(), status: 'membership_mismatch' }]),
      { memoryId: 'memory-failed', status: 'failed', failure: 'network' }
    ]));
    expect(html.match(/暂时无法读取这条原话。/g)).toHaveLength(2);
    expect(html).not.toContain('membership_mismatch');
    expect(html).not.toContain('network');
  });

  it('keeps multiple Memory refs visibly separate and ordered', () => {
    const html = renderLoaded(result([
      resolvedMemory('memory-a', []),
      resolvedMemory('memory-b', [])
    ]));
    expect(html).toContain('记忆 1');
    expect(html).toContain('记忆 2');
    expect(html.indexOf('data-memory-id="memory-a"')).toBeLessThan(html.indexOf('data-memory-id="memory-b"'));
  });

  it('renders thrown-load failures as safe local failed state', () => {
    const html = renderToStaticMarkup(
      <MessageAqiMemoryEvidenceView state={{ status: 'failed' }} onRead={() => {}} />
    );
    expect(html).toContain('暂时无法读取这条原话。');
    expect(html).not.toMatch(/stack|token|bearer/i);
  });
});
