import { buildInternalApiEndpoint } from '../../engines/chat-api/chatApiEndpoint';
import { validateAqiMemoryReceipt } from '../../engines/chat-api/aqiMemoryReceipt';
import type { AqiMemoryReceipt, ChatMessage } from '../../types/domain';

const EVIDENCE_SCHEMA = 'aqi-memory-source-evidence/v0';
const EVIDENCE_AUTHORITY = 'aqi-home-core';
const TOP_LEVEL_KEYS = new Set(['schema', 'authority', 'memoryId', 'sources']);
const REF_KEYS = new Set(['schema', 'authority', 'kind', 'messageId']);
const REF_WITH_CONTEXT_KEYS = new Set([...REF_KEYS, 'contextHint']);
const CONTEXT_HINT_KEYS = new Set(['membershipId']);
const NON_RESOLVED_SOURCE_KEYS = new Set(['ref', 'status']);
const MEMBERSHIP_REQUIRED_KEYS = new Set([
  'ref',
  'status',
  'messageId',
  'contextState',
  'membershipCount'
]);
const CONTEXT_MISSING_KEYS = new Set([
  'ref',
  'status',
  'messageId',
  'role',
  'content',
  'selectedMembershipId',
  'contextState'
]);
const RESOLVED_SOURCE_KEYS = new Set([
  ...CONTEXT_MISSING_KEYS,
  'sourceConversationId',
  'onActivePath'
]);
const NON_RESOLVED_STATUSES = new Set([
  'invalid_ref',
  'missing_target',
  'conflicted_target',
  'membership_mismatch',
  'policy_blocked'
]);

export type AqiMemorySourceRef = {
  schema: 'aqi-source-ref/v0';
  authority: 'aqi-chat-ledger';
  kind: 'message';
  messageId: string;
  contextHint?: { membershipId: string };
};

export type AqiMemorySourceEvidenceContent =
  | { content_type: 'text'; parts: string[] }
  | {
      content_type: 'multimodal_text';
      parts: Array<string | { content_type: 'caption'; text: string }>;
    }
  | { content_type: 'code'; text: string }
  | null;

export type AqiMemorySourceEvidenceSource =
  | {
      ref: AqiMemorySourceRef | null;
      status: 'invalid_ref' | 'missing_target' | 'conflicted_target' | 'membership_mismatch' | 'policy_blocked';
    }
  | {
      ref: AqiMemorySourceRef;
      status: 'resolved';
      messageId: string;
      contextState: 'membership_required';
      membershipCount: number;
    }
  | {
      ref: AqiMemorySourceRef;
      status: 'resolved';
      messageId: string;
      role: 'user' | 'assistant';
      content: AqiMemorySourceEvidenceContent;
      selectedMembershipId: string;
      contextState: 'context_missing';
    }
  | {
      ref: AqiMemorySourceRef;
      status: 'resolved';
      messageId: string;
      role: 'user' | 'assistant';
      content: AqiMemorySourceEvidenceContent;
      selectedMembershipId: string;
      contextState: 'resolved';
      sourceConversationId: string;
      onActivePath: boolean;
    };

export type AqiMemorySourceEvidenceDto = {
  schema: 'aqi-memory-source-evidence/v0';
  authority: 'aqi-home-core';
  memoryId: string;
  sources: AqiMemorySourceEvidenceSource[];
};

export type AqiMemorySourceEvidenceFailure =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'server_error'
  | 'http_error'
  | 'invalid_response';

export type AqiMemorySourceEvidenceForMessageResult = {
  assistantMessageId: string;
  status: 'no_receipt' | 'invalid_receipt' | 'no_refs' | 'complete' | 'partial_failure' | 'failed';
  receiptIdentityState: AqiMemoryReceipt['identityState'] | null;
  memories: Array<
    | {
        memoryId: string;
        status: 'resolved';
        evidence: AqiMemorySourceEvidenceDto;
      }
    | {
        memoryId: string;
        status: 'failed';
        failure: AqiMemorySourceEvidenceFailure;
      }
  >;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function validateSourceRef(value: unknown): AqiMemorySourceRef {
  if (!isRecord(value)) throw new TypeError('source ref is invalid');
  const hasContext = value.contextHint !== undefined;
  if (!hasExactKeys(value, hasContext ? REF_WITH_CONTEXT_KEYS : REF_KEYS)) {
    throw new TypeError('source ref is invalid');
  }
  if (
    value.schema !== 'aqi-source-ref/v0'
    || value.authority !== 'aqi-chat-ledger'
    || value.kind !== 'message'
    || !nonEmptyString(value.messageId)
  ) {
    throw new TypeError('source ref is invalid');
  }
  let contextHint: { membershipId: string } | undefined;
  if (hasContext) {
    if (
      !isRecord(value.contextHint)
      || !hasExactKeys(value.contextHint, CONTEXT_HINT_KEYS)
      || !nonEmptyString(value.contextHint.membershipId)
    ) {
      throw new TypeError('source ref is invalid');
    }
    contextHint = { membershipId: value.contextHint.membershipId };
  }
  return {
    schema: 'aqi-source-ref/v0',
    authority: 'aqi-chat-ledger',
    kind: 'message',
    messageId: value.messageId,
    ...(contextHint ? { contextHint } : {})
  };
}

function validateEvidenceContent(value: unknown): AqiMemorySourceEvidenceContent {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.content_type !== 'string') {
    throw new TypeError('source content is invalid');
  }
  if (value.content_type === 'text') {
    if (
      !hasExactKeys(value, new Set(['content_type', 'parts']))
      || !Array.isArray(value.parts)
      || !value.parts.every((part) => typeof part === 'string')
    ) {
      throw new TypeError('source content is invalid');
    }
    return { content_type: 'text', parts: [...value.parts] };
  }
  if (value.content_type === 'multimodal_text') {
    if (!hasExactKeys(value, new Set(['content_type', 'parts'])) || !Array.isArray(value.parts)) {
      throw new TypeError('source content is invalid');
    }
    const parts = value.parts.map((part) => {
      if (typeof part === 'string') return part;
      if (
        !isRecord(part)
        || !hasExactKeys(part, new Set(['content_type', 'text']))
        || part.content_type !== 'caption'
        || typeof part.text !== 'string'
      ) {
        throw new TypeError('source content is invalid');
      }
      return { content_type: 'caption' as const, text: part.text };
    });
    return { content_type: 'multimodal_text', parts };
  }
  if (
    value.content_type === 'code'
    && hasExactKeys(value, new Set(['content_type', 'text']))
    && typeof value.text === 'string'
  ) {
    return { content_type: 'code', text: value.text };
  }
  throw new TypeError('source content is invalid');
}

function validateEvidenceSource(value: unknown): AqiMemorySourceEvidenceSource {
  if (!isRecord(value) || typeof value.status !== 'string') {
    throw new TypeError('source evidence entry is invalid');
  }
  if (NON_RESOLVED_STATUSES.has(value.status)) {
    if (!hasExactKeys(value, NON_RESOLVED_SOURCE_KEYS)) {
      throw new TypeError('source evidence entry is invalid');
    }
    const ref = value.status === 'invalid_ref' && value.ref === null
      ? null
      : validateSourceRef(value.ref);
    return {
      ref,
      status: value.status as Exclude<AqiMemorySourceEvidenceSource['status'], 'resolved'>
    };
  }
  if (value.status !== 'resolved' || !nonEmptyString(value.messageId)) {
    throw new TypeError('source evidence entry is invalid');
  }
  const ref = validateSourceRef(value.ref);
  if (value.contextState === 'membership_required') {
    if (
      !hasExactKeys(value, MEMBERSHIP_REQUIRED_KEYS)
      || !Number.isInteger(value.membershipCount)
      || (value.membershipCount as number) <= 1
    ) {
      throw new TypeError('source evidence entry is invalid');
    }
    return {
      ref,
      status: 'resolved',
      messageId: value.messageId,
      contextState: 'membership_required',
      membershipCount: value.membershipCount as number
    };
  }
  if (
    value.contextState !== 'context_missing'
    && value.contextState !== 'resolved'
  ) {
    throw new TypeError('source evidence entry is invalid');
  }
  const expectedKeys = value.contextState === 'resolved'
    ? RESOLVED_SOURCE_KEYS
    : CONTEXT_MISSING_KEYS;
  if (
    !hasExactKeys(value, expectedKeys)
    || (value.role !== 'user' && value.role !== 'assistant')
    || !nonEmptyString(value.selectedMembershipId)
  ) {
    throw new TypeError('source evidence entry is invalid');
  }
  const role: 'user' | 'assistant' = value.role;
  const shared = {
    ref,
    status: 'resolved' as const,
    messageId: value.messageId,
    role,
    content: validateEvidenceContent(value.content),
    selectedMembershipId: value.selectedMembershipId
  };
  if (value.contextState === 'context_missing') {
    return { ...shared, contextState: 'context_missing' };
  }
  if (!nonEmptyString(value.sourceConversationId) || typeof value.onActivePath !== 'boolean') {
    throw new TypeError('source evidence entry is invalid');
  }
  return {
    ...shared,
    contextState: 'resolved',
    sourceConversationId: value.sourceConversationId,
    onActivePath: value.onActivePath
  };
}

export function validateAqiMemorySourceEvidence(
  value: unknown,
  expectedMemoryId: string
): AqiMemorySourceEvidenceDto {
  if (
    !isRecord(value)
    || !hasExactKeys(value, TOP_LEVEL_KEYS)
    || value.schema !== EVIDENCE_SCHEMA
    || value.authority !== EVIDENCE_AUTHORITY
    || value.memoryId !== expectedMemoryId
    || !Array.isArray(value.sources)
  ) {
    throw new TypeError('Aqi Memory source evidence response is invalid');
  }
  return {
    schema: EVIDENCE_SCHEMA,
    authority: EVIDENCE_AUTHORITY,
    memoryId: expectedMemoryId,
    sources: value.sources.map(validateEvidenceSource)
  };
}

function failureForStatus(status: number): AqiMemorySourceEvidenceFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server_error';
  return 'http_error';
}

export async function readAqiMemorySourceEvidence(
  memoryId: string,
  options: { fetchImpl?: typeof fetch } = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      buildInternalApiEndpoint(`/api/memory/source-evidence/${encodeURIComponent(memoryId)}`),
      {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      }
    );
  } catch {
    return { status: 'failed' as const, failure: 'network' as const };
  }
  if (!response.ok) {
    return { status: 'failed' as const, failure: failureForStatus(response.status) };
  }
  try {
    return {
      status: 'resolved' as const,
      evidence: validateAqiMemorySourceEvidence(await response.json(), memoryId)
    };
  } catch {
    return { status: 'failed' as const, failure: 'invalid_response' as const };
  }
}

export async function readAqiMemorySourceEvidenceForMessage(
  message: Pick<ChatMessage, 'id' | 'role' | 'aqiMemoryReceipt'>,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<AqiMemorySourceEvidenceForMessageResult> {
  const base = { assistantMessageId: message.id };
  if (!message.aqiMemoryReceipt) {
    return { ...base, status: 'no_receipt', receiptIdentityState: null, memories: [] };
  }
  if (message.role !== 'assistant') {
    return { ...base, status: 'invalid_receipt', receiptIdentityState: null, memories: [] };
  }
  let receipt: AqiMemoryReceipt;
  try {
    receipt = validateAqiMemoryReceipt(message.aqiMemoryReceipt);
  } catch {
    return { ...base, status: 'invalid_receipt', receiptIdentityState: null, memories: [] };
  }
  if (receipt.memoryRefs.length === 0) {
    return {
      ...base,
      status: 'no_refs',
      receiptIdentityState: receipt.identityState,
      memories: []
    };
  }
  const memories = await Promise.all(receipt.memoryRefs.map(async ({ memoryId }) => {
    const result = await readAqiMemorySourceEvidence(memoryId, options);
    return result.status === 'resolved'
      ? { memoryId, status: 'resolved' as const, evidence: result.evidence }
      : { memoryId, status: 'failed' as const, failure: result.failure };
  }));
  const failureCount = memories.filter((memory) => memory.status === 'failed').length;
  return {
    ...base,
    status: failureCount === 0
      ? 'complete'
      : failureCount === memories.length
        ? 'failed'
        : 'partial_failure',
    receiptIdentityState: receipt.identityState,
    memories
  };
}
