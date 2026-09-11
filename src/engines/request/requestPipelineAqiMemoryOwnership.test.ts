import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPersonaTemplate } from '../../config/persona/personaBuilder';
import type { ProviderProfile } from '../../types/domain';
import { requestCollaboratorReply } from './requestPipeline';

const requestAssistantReplyMock = vi.hoisted(() => vi.fn());

vi.mock('../chatApi', () => ({
  requestAssistantReply: requestAssistantReplyMock
}));

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
      personalMemories: ['POLARIS_CONFIRMED_MEMORY_SENTINEL'],
      conversationSummaries: [{
        id: 'summary-1',
        kind: 'relational_profile',
        title: '旧总结',
        content: 'POLARIS_SUMMARY_SENTINEL',
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

describe('requestPipeline Aqi Home memory ownership', () => {
  beforeEach(() => {
    requestAssistantReplyMock.mockReset();
    requestAssistantReplyMock.mockResolvedValue({ content: 'ok' });
  });

  it('projects Polaris native memory out of the full Aqi Home request pipeline', async () => {
    const persona = createMemoryPersona();

    await requestCollaboratorReply({
      api: aqiProvider,
      persona,
      semanticRecallEnabled: true,
      activeConversationId: 'conversation-aqi-1',
      messages: [{
        id: 'current-user',
        role: 'user',
        content: 'CURRENT_RAW_CHAT_SENTINEL',
        timestamp: 1
      }]
    });

    expect(requestAssistantReplyMock).toHaveBeenCalledTimes(1);
    const request = requestAssistantReplyMock.mock.calls[0]?.[0];
    const serializedContext = JSON.stringify(request?.context);

    expect(request?.sessionId).toBe('conversation-aqi-1');
    expect(serializedContext).toContain('CURRENT_RAW_CHAT_SENTINEL');
    expect(serializedContext).not.toContain('POLARIS_CONFIRMED_MEMORY_SENTINEL');
    expect(serializedContext).not.toContain('POLARIS_SUMMARY_SENTINEL');

    expect(persona.memory.personalMemories).toEqual(['POLARIS_CONFIRMED_MEMORY_SENTINEL']);
    expect(persona.memory.inheritGlobal).toBe(true);
    expect(persona.memory.crossConversationRecallEnabled).toBe(true);
  });

  it('leaves direct-provider request memory behavior unchanged', async () => {
    const persona = createMemoryPersona();

    await requestCollaboratorReply({
      api: externalProvider,
      persona,
      semanticRecallEnabled: false,
      activeConversationId: 'conversation-external-1',
      messages: [{
        id: 'current-user',
        role: 'user',
        content: 'CURRENT_EXTERNAL_CHAT',
        timestamp: 1
      }]
    });

    const request = requestAssistantReplyMock.mock.calls[0]?.[0];
    const serializedContext = JSON.stringify(request?.context);

    expect(request?.sessionId).toBe('conversation-external-1');
    expect(serializedContext).toContain('POLARIS_CONFIRMED_MEMORY_SENTINEL');
    expect(persona.memory.personalMemories).toEqual(['POLARIS_CONFIRMED_MEMORY_SENTINEL']);
  });
});
