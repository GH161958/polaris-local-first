import type { PersonaAdvancedSettings, ProviderProfile } from '../../types/domain';
import type { AssistantRequestContext } from '../request/requestContext';
import { buildProviderRuntimeRequest } from '../provider-runtime/providerRuntimeRequest';
import type { BuiltRequest } from './chatApiTypes';
import type { OpenAiToolHistoryMode } from '../provider-runtime/providerRuntimeOpenAiToolHistory';
import { isAqiHomeCoreRoute } from '../aqiHomeMemoryOwnership';

export function buildApiRequest(params: {
  api: ProviderProfile;
  context: AssistantRequestContext;
  sessionId?: string;
  advanced?: PersonaAdvancedSettings;
  bodyOverrides?: Record<string, unknown>;
  openAiToolHistoryMode?: OpenAiToolHistoryMode;
}): BuiltRequest {
  const request = buildProviderRuntimeRequest(params);
  const conversationId = params.sessionId?.trim();
  if (!conversationId || !isAqiHomeCoreRoute(params.api)) {
    return request;
  }

  // This is only a replaceable-shell session hint for Aqi Home Memory wake
  // caching. It is not Chat Ledger message identity and is never added to
  // direct/external provider requests.
  return {
    ...request,
    headers: {
      ...request.headers,
      'X-Aqi-Conversation-Id': conversationId
    }
  };
}
