import type { Persona, ProviderProfile } from '../types/domain';
import type { PolarisToolPromptPreferences } from './assistantToolProtocol';

export type AqiHomeRoute = Pick<ProviderProfile, 'baseUrl' | 'path'>;

function normalizeRoutePart(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function isAqiHomeCoreRoute(api: AqiHomeRoute) {
  const baseUrl = normalizeRoutePart(api.baseUrl);
  const path = api.path.trim().startsWith('/') ? api.path.trim() : `/${api.path.trim()}`;
  return baseUrl === '/api' && path === '/chat/completions';
}

export function resolveAqiHomeRequestMemoryOwnership(params: {
  api: AqiHomeRoute;
  persona: Persona | null | undefined;
  semanticRecallEnabled?: boolean;
  enabledToolGroups?: PolarisToolPromptPreferences;
}) {
  if (!isAqiHomeCoreRoute(params.api)) {
    return {
      persona: params.persona,
      semanticRecallEnabled: params.semanticRecallEnabled,
      enabledToolGroups: params.enabledToolGroups
    };
  }

  const persona = params.persona
    ? {
        ...params.persona,
        memory: {
          ...params.persona.memory,
          inheritGlobal: false,
          crossConversationRecallEnabled: false,
          personalMemories: []
        }
      }
    : params.persona;

  return {
    persona,
    semanticRecallEnabled: false,
    enabledToolGroups: {
      ...params.enabledToolGroups,
      memory: false,
      memoryRecall: false
    }
  };
}
