import { describe, expect, it } from 'vitest';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import { prepareCollaboratorReplyRequest } from './request/requestPreparation';
import {
  isAqiHomeCoreRoute,
  resolveAqiHomeRequestMemoryOwnership
} from './aqiHomeMemoryOwnership';
import type { ProviderProfile } from '../types/domain';

const aqiProvider: ProviderProfile = {
  id: 'aqi-home',
  name: 'Aqi Home',
  protocol: 'openai-completions',
  baseUrl: '/api',
  path: '/chat/completions',
  apiKey: 'internal',
  model: 'aqi-home',
  capabilities: {
    images: false,
    streaming: true,
    thinking: false
  }
};

const externalProvider: ProviderProfile = {
  ...aqiProvider,
  id: 'external',
  name: 'External',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-test'
};

function createMemoryPersona() {
  return createPersonaTemplate({
    id: 'pharos',
    name: 'Pharos',
    description: '灯塔',
    memory: {
      inheritGlobal: true,
      crossConversationRecallEnabled: true,
      personalMemories: ['这条 Polaris confirmed memory 不应进入 Aqi Home 请求。'],
      conversationSummaries: [{
        id: 'summary-1',
        kind: 'relational_profile',
        title: '旧总结',
        content: '这条 Polaris summary 也不应进入 Aqi Home 请求。',
        sequence: 1,
        sourceConversationIds: ['old-conversation'],
        sourceMessageIds: ['old-message'],
        sourceCharCount: 100,
        generator: 'manual',
        generatedAt: 1,
        updatedAt: 1
      }]
    }
  });
}

describe('Aqi Home Memory request ownership', () => {
  it('recognizes only the relative Aqi Home chat route', () => {
    expect(isAqiHomeCoreRoute({ baseUrl: '/api', path: '/chat/completions' })).toBe(true);
    expect(isAqiHomeCoreRoute({ baseUrl: '/api/', path: 'chat/completions' })).toBe(true);
    expect(isAqiHomeCoreRoute({ baseUrl: 'https://api.openai.com/v1', path: '/chat/completions' })).toBe(false);
  });

  it('projects native Polaris memory out of Aqi Home requests without mutating persistence', () => {
    const persona = createMemoryPersona();
    const result = resolveAqiHomeRequestMemoryOwnership({
      api: aqiProvider,
      persona,
      semanticRecallEnabled: true
    });

    expect(result.semanticRecallEnabled).toBe(false);
    expect(result.persona).not.toBe(persona);
    expect(result.persona?.memory.personalMemories).toEqual([]);
    expect(result.persona?.memory.inheritGlobal).toBe(false);
    expect(result.persona?.memory.crossConversationRecallEnabled).toBe(false);

    expect(persona.memory.personalMemories).toEqual([
      '这条 Polaris confirmed memory 不应进入 Aqi Home 请求。'
    ]);
    expect(persona.memory.inheritGlobal).toBe(true);
    expect(persona.memory.crossConversationRecallEnabled).toBe(true);
  });

  it('leaves direct-provider memory behavior unchanged', () => {
    const persona = createMemoryPersona();
    const result = resolveAqiHomeRequestMemoryOwnership({
      api: externalProvider,
      persona,
      semanticRecallEnabled: true
    });

    expect(result.persona).toBe(persona);
    expect(result.semanticRecallEnabled).toBe(true);
  });

  it('produces an Aqi Home request context with raw chat but no native memory lanes', async () => {
    const persona = createMemoryPersona();
    const ownership = resolveAqiHomeRequestMemoryOwnership({
      api: aqiProvider,
      persona,
      semanticRecallEnabled: true
    });
    const prepared = await prepareCollaboratorReplyRequest({
      api: aqiProvider,
      persona: ownership.persona,
      semanticRecallEnabled: ownership.semanticRecallEnabled,
      messages: [{
        id: 'current-user',
        role: 'user',
        content: '这是当前对话原话，应该保留。',
        timestamp: 10
      }],
      activeConversationId: 'conversation-current'
    });

    expect(prepared.context.segments.some((segment) => segment.kind === 'memory')).toBe(false);
    expect(prepared.context.segments.some((segment) => segment.kind === 'semantic_recall')).toBe(false);
    expect(prepared.context.segments.some((segment) => segment.kind === 'conversation_summary')).toBe(false);
    expect(prepared.context.segments.some((segment) =>
      segment.kind === 'conversation'
      && segment.messages.some((message) => message.content === '这是当前对话原话，应该保留。')
    )).toBe(true);
  });
});
