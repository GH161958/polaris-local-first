import type { ChatMessage, ProviderProfile } from '../../types/domain';
import { buildInternalApiEndpoint } from '../../engines/chat-api/chatApiEndpoint';

type LedgerTerminalStatus = 'completed' | 'aborted' | 'failed';

function normalizeRoutePart(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function isAqiHomeCoreRoute(api: Pick<ProviderProfile, 'baseUrl' | 'path'>) {
  const baseUrl = normalizeRoutePart(api.baseUrl);
  const path = api.path.trim().startsWith('/') ? api.path.trim() : `/${api.path.trim()}`;
  return baseUrl === '/api' && path === '/chat/completions';
}

function resolveLatestAssistantLifecycle(
  message: ChatMessage,
  isLatestAssistant: boolean,
  terminalStatus?: LedgerTerminalStatus
) {
  if (!isLatestAssistant || !terminalStatus || terminalStatus === 'completed') {
    return 'complete' as const;
  }

  if (terminalStatus === 'aborted') {
    return 'aborted' as const;
  }

  return message.requestRole === 'system' || !message.content.trim()
    ? 'error' as const
    : 'interrupted' as const;
}

export async function mirrorAqiConversationSnapshot(params: {
  api: Pick<ProviderProfile, 'baseUrl' | 'path'>;
  conversationId: string;
  messages: ChatMessage[];
  terminalStatus?: LedgerTerminalStatus;
}) {
  if (!isAqiHomeCoreRoute(params.api)) return;

  const visibleMessages = params.messages.filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  );
  let latestAssistantIndex = -1;
  for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
    if (visibleMessages[index]?.role === 'assistant') {
      latestAssistantIndex = index;
      break;
    }
  }

  const response = await fetch(buildInternalApiEndpoint('/api/ledger/snapshot'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceSystem: 'polaris',
      sourceConversationId: params.conversationId,
      messages: visibleMessages.map((message, index) => ({
        sourceMessageId: message.id,
        ordinal: index + 1,
        role: message.role,
        content: message.content,
        lifecycle: resolveLatestAssistantLifecycle(
          message,
          index === latestAssistantIndex,
          params.terminalStatus
        ),
        providerModel: message.model,
        createdAt: message.timestamp
      }))
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Aqi Ledger mirror failed: HTTP ${response.status} ${text.slice(0, 180)}`);
  }
}
