import { describe, expect, it } from 'vitest';
import {
  buildAssistantMessagePatch,
  normalizeChatMessage,
  normalizeChatNativeToolCalls
} from './chatMessageNormalization';

describe('chatMessageNormalization', () => {
  it('normalizes native tool calls into stable ids and strips blank names', () => {
    expect(normalizeChatNativeToolCalls('assistant-1', [
      {
        name: '  runCode  ',
        argumentsText: '{"code":"return 1;"}'
      },
      {
        name: '   ',
        argumentsText: '{}'
      }
    ])).toEqual([
      {
        id: 'assistant-1:tool-call:1',
        name: 'runCode',
        argumentsText: '{"code":"return 1;"}',
        sourceSpan: {
          transport: 'native',
          index: 0
        }
      }
    ]);
  });

  it('normalizes persisted assistant messages through the same helper', () => {
    expect(normalizeChatMessage({
      id: 'assistant-2',
      role: 'assistant',
      content: 'pong',
      timestamp: 1,
      thinkingText: '   ',
      nativeToolCalls: [
        {
          name: 'createQrCode',
          argumentsText: '{"text":"https://polaris.example.com"}'
        }
      ]
    })).toEqual({
      id: 'assistant-2',
      role: 'assistant',
      content: 'pong',
      timestamp: 1,
      thinkingText: undefined,
      nativeToolCalls: [
        {
          id: 'assistant-2:tool-call:1',
          name: 'createQrCode',
          argumentsText: '{"text":"https://polaris.example.com"}',
          sourceSpan: {
            transport: 'native',
            index: 0
          }
        }
      ]
    });
  });

  it('builds the same assistant message patch shape for streaming and final writes', () => {
    expect(buildAssistantMessagePatch({
      messageId: 'assistant-3',
      assistantName: 'Pharos',
      visibleContent: '整理好了。',
      reply: {
        model: 'mimo-v2-pro',
        tokenCount: 128,
        thinkingText: '先看约束。'
      },
      nativeToolCalls: [
        {
          id: 'call-1',
          name: 'runCode',
          argumentsText: '{"code":"return 3;"}'
        }
      ]
    })).toEqual({
      content: '整理好了。',
      model: 'mimo-v2-pro',
      tokenCount: 128,
      assistantName: 'Pharos',
      thinkingText: '先看约束。',
      nativeToolCalls: [
        {
          id: 'call-1',
          name: 'runCode',
          argumentsText: '{"code":"return 3;"}',
          sourceSpan: {
            transport: 'native',
            index: 0
          }
        }
      ]
    });
  });

  it('binds Aqi receipt to the exact assistant message independently of semantic evidence', () => {
    const aqiMemoryReceipt = {
      schema: 'aqi-memory-receipt/v0' as const,
      authority: 'aqi-home-core' as const,
      identityState: 'resolved' as const,
      memoryRefs: [{ memoryId: 'memory-exact' }]
    };
    const memoryEvidence = {
      requestId: 'local-semantic-request',
      strategy: 'semantic_index' as const,
      status: 'within_budget' as const,
      items: []
    };

    const firstPatch = buildAssistantMessagePatch({
      messageId: 'assistant-1',
      assistantName: 'Pharos',
      visibleContent: 'first exact text',
      reply: { aqiMemoryReceipt },
      memoryEvidence
    });
    const secondPatch = buildAssistantMessagePatch({
      messageId: 'assistant-2',
      assistantName: 'Pharos',
      visibleContent: 'second exact text',
      reply: {}
    });

    expect(firstPatch).toMatchObject({
      content: 'first exact text',
      aqiMemoryReceipt,
      memoryEvidence
    });
    expect(secondPatch.aqiMemoryReceipt).toBeUndefined();
    expect(secondPatch.memoryEvidence).toBeUndefined();
  });
});
