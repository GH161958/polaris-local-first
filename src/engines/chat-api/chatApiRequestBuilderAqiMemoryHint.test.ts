import { describe, expect, it } from 'vitest';
import { createProviderRuntimeTestContext, createProviderRuntimeTestProvider } from '../provider-runtime/providerRuntimeFixtures';
import { buildApiRequest } from './chatApiRequestBuilder';

describe('buildApiRequest Aqi Home Memory hint', () => {
  it('adds the conversation hint only to the relative Aqi Home route', () => {
    const aqiRequest = buildApiRequest({
      api: createProviderRuntimeTestProvider({
        baseUrl: '/api',
        path: '/chat/completions',
        model: 'aqi-home'
      }),
      context: createProviderRuntimeTestContext(),
      sessionId: 'conversation-aqi-memory-1'
    });

    expect(aqiRequest.headers['X-Aqi-Conversation-Id']).toBe('conversation-aqi-memory-1');
  });

  it('does not leak the Aqi conversation hint to direct external providers', () => {
    const externalRequest = buildApiRequest({
      api: createProviderRuntimeTestProvider({
        baseUrl: 'https://api.openai.com/v1',
        path: '/chat/completions',
        model: 'gpt-test'
      }),
      context: createProviderRuntimeTestContext(),
      sessionId: 'conversation-must-not-leak'
    });

    expect(externalRequest.headers).not.toHaveProperty('X-Aqi-Conversation-Id');
  });

  it('does not add the hint when no session identity is available', () => {
    const request = buildApiRequest({
      api: createProviderRuntimeTestProvider({
        baseUrl: '/api',
        path: '/chat/completions',
        model: 'aqi-home'
      }),
      context: createProviderRuntimeTestContext()
    });

    expect(request.headers).not.toHaveProperty('X-Aqi-Conversation-Id');
  });
});
