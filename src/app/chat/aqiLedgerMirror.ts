import type { ChatMessage, ProviderProfile } from '../../types/domain';
import { buildInternalApiEndpoint } from '../../engines/chat-api/chatApiEndpoint';

export type AqiLedgerLifecycle =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'aborted'
  | 'error'
  | 'interrupted';

function normalizeRoutePart(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function isAqiHomeCoreRoute(api: Pick<ProviderProfile, 'baseUrl' | 'path'>) {
  const baseUrl = normalizeRoutePart(api.baseUrl);
  const path = api.path.trim().startsWith('/') ? api.path.trim() : `/${api.path.trim()}`;
  return baseUrl === '/api' && path === '/chat/completions';
}

export function shouldUsePolarisSemanticRecall(
  api: Pick<ProviderProfile, 'baseUrl' | 'path'>,
  userEnabled: boolean
) {
  return userEnabled && !isAqiHomeCoreRoute(api);
}

async function postVisibleMessage(params: {
  api: Pick<ProviderProfile, 'baseUrl' | 'path'>;
  conversationId: string;
  sourceMessageId: string;
  role: 'user' | 'assistant';
  content: string;
  lifecycle: AqiLedgerLifecycle;
  providerModel?: string;
  createdAt?: number;
}) {
  if (!isAqiHomeCoreRoute(params.api)) return;

  // Empty assistant placeholders/tool-only internals are not visible chat originals.
  if (params.role === 'assistant' && !params.content.trim()) return;

  const response = await fetch(buildInternalApiEndpoint('/api/ledger/message'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceSystem: 'polaris',
      sourceConversationId: params.conversationId,
      sourceMessageId: params.sourceMessageId,
      role: params.role,
      content: params.content,
      lifecycle: params.lifecycle,
      providerModel: params.providerModel,
      createdAt: params.createdAt
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Aqi Ledger mirror failed: HTTP ${response.status} ${text.slice(0, 180)}`);
  }
}

export async function mirrorAqiVisibleUserBeforeRequest(params: {
  api: Pick<ProviderProfile, 'baseUrl' | 'path'>;
  conversationId: string;
  messages: ChatMessage[];
}) {
  if (!isAqiHomeCoreRoute(params.api)) return;

  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index];
    if (
      message.role !== 'user'
      || message.toolInvocation
      || message.origin === 'system-note'
      || message.origin === 'trigger-runtime'
    ) {
      continue;
    }

    await postVisibleMessage({
      api: params.api,
      conversationId: params.conversationId,
      sourceMessageId: message.id,
      role: 'user',
      content: message.content,
      lifecycle: 'complete',
      createdAt: message.timestamp
    });
    return;
  }
}

export async function mirrorAqiVisibleAssistant(params: {
  api: Pick<ProviderProfile, 'baseUrl' | 'path'>;
  conversationId: string;
  sourceMessageId: string;
  content: string;
  lifecycle: AqiLedgerLifecycle;
  providerModel?: string;
  createdAt?: number;
}) {
  await postVisibleMessage({
    api: params.api,
    conversationId: params.conversationId,
    sourceMessageId: params.sourceMessageId,
    role: 'assistant',
    content: params.content,
    lifecycle: params.lifecycle,
    providerModel: params.providerModel,
    createdAt: params.createdAt
  });
}
