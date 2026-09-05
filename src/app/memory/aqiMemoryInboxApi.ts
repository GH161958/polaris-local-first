import { notifyAqiHomeAuthRequired } from '../chat/aqiHomeAuth';
import { buildInternalApiEndpoint } from '../../engines/chat-api/chatApiEndpoint';

export type MemoryCandidateLifecycle = 'pending' | 'approved' | 'rejected' | 'superseded';
export type MemoryPromotionLifecycle =
  | 'prepared'
  | 'dispatching'
  | 'indeterminate'
  | 'failed'
  | 'source_attachment_pending'
  | 'source_attachment_failed'
  | 'source_attachment_indeterminate'
  | 'succeeded';

export type MemoryCandidateSummary = {
  candidateId: string;
  title: string;
  content: string;
  lifecycle: MemoryCandidateLifecycle;
  createdAt: number;
};

export type MemoryCandidateDetail = MemoryCandidateSummary & {
  memorablePhrases: string[];
  sharedSymbols: string[];
};

export type MemoryPromotionRead = {
  candidateId: string;
  exists: boolean;
  lifecycle?: MemoryPromotionLifecycle;
  memoryId?: string;
  completedAt?: number;
};

export type MemoryEvidenceSource =
  | { status: 'resolved'; role: 'user' | 'assistant'; text: string; contextState: 'resolved' | 'context_missing' }
  | { status: 'membership_required'; membershipCount: number }
  | { status: 'unavailable' };

export class AqiMemoryInboxApiError extends Error {
  constructor(
    public readonly kind: 'unauthorized' | 'not_found' | 'conflict' | 'unavailable' | 'invalid_response',
    public readonly status: number | null = null
  ) {
    super(`Aqi Memory Inbox request failed: ${kind}`);
    this.name = 'AqiMemoryInboxApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return value;
}

function stringList(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return [...value];
}

function lifecycle(value: unknown): MemoryCandidateLifecycle {
  if (!['pending', 'approved', 'rejected', 'superseded'].includes(String(value))) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return value as MemoryCandidateLifecycle;
}

function promotionLifecycle(value: unknown): MemoryPromotionLifecycle {
  if (![
    'prepared',
    'dispatching',
    'indeterminate',
    'failed',
    'source_attachment_pending',
    'source_attachment_failed',
    'source_attachment_indeterminate',
    'succeeded'
  ].includes(String(value))) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return value as MemoryPromotionLifecycle;
}

function candidateSummary(value: unknown): MemoryCandidateSummary {
  if (!isRecord(value) || !Number.isFinite(value.createdAt)) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return {
    candidateId: requiredString(value.candidateId),
    title: requiredString(value.title),
    content: requiredString(value.content),
    lifecycle: lifecycle(value.lifecycle),
    createdAt: value.createdAt as number
  };
}

function candidateDetail(value: unknown): MemoryCandidateDetail {
  if (!isRecord(value)) throw new AqiMemoryInboxApiError('invalid_response');
  return {
    ...candidateSummary(value),
    memorablePhrases: stringList(value.memorablePhrases),
    sharedSymbols: stringList(value.sharedSymbols)
  };
}

function mapFailure(status: number) {
  if (status === 401) {
    notifyAqiHomeAuthRequired();
    return new AqiMemoryInboxApiError('unauthorized', status);
  }
  if (status === 404) return new AqiMemoryInboxApiError('not_found', status);
  if (status === 409) return new AqiMemoryInboxApiError('conflict', status);
  return new AqiMemoryInboxApiError('unavailable', status);
}

async function fetchJson(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await fetchImpl(buildInternalApiEndpoint(path), {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...Object.fromEntries(new Headers(init.headers).entries())
      }
    });
  } catch {
    throw new AqiMemoryInboxApiError('unavailable');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw response.ok
      ? new AqiMemoryInboxApiError('invalid_response', response.status)
      : mapFailure(response.status);
  }
  return { response, payload };
}

export async function listMemoryCandidates(
  status: Extract<MemoryCandidateLifecycle, 'pending' | 'approved' | 'rejected'>,
  offset = 0,
  options: { fetchImpl?: typeof fetch } = {}
) {
  const { response, payload } = await fetchJson(
    `/api/memory/candidates?status=${status}&limit=50&offset=${offset}`,
    {},
    options.fetchImpl
  );
  if (!response.ok) throw mapFailure(response.status);
  if (
    !isRecord(payload)
    || payload.schema !== 'aqi-memory-formation-candidate-list/v0'
    || payload.authority !== 'aqi-home-core'
    || !Array.isArray(payload.candidates)
    || !isRecord(payload.page)
    || !Number.isInteger(payload.page.total)
    || !Number.isInteger(payload.page.offset)
    || (payload.page.nextOffset !== null && !Number.isInteger(payload.page.nextOffset))
  ) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return {
    candidates: payload.candidates.map(candidateSummary),
    page: {
      total: payload.page.total as number,
      offset: payload.page.offset as number,
      nextOffset: payload.page.nextOffset as number | null
    }
  };
}

export async function readMemoryCandidate(
  candidateId: string,
  options: { fetchImpl?: typeof fetch } = {}
) {
  const { response, payload } = await fetchJson(
    `/api/memory/candidates/${encodeURIComponent(candidateId)}`,
    {},
    options.fetchImpl
  );
  if (!response.ok) throw mapFailure(response.status);
  if (
    !isRecord(payload)
    || payload.schema !== 'aqi-memory-formation-candidate-review/v0'
    || payload.authority !== 'aqi-home-core'
  ) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return candidateDetail(payload);
}

export async function readMemoryPromotion(
  candidateId: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<MemoryPromotionRead> {
  const { response, payload } = await fetchJson(
    `/api/memory/candidates/${encodeURIComponent(candidateId)}/promotion`,
    {},
    options.fetchImpl
  );
  if (!response.ok) throw mapFailure(response.status);
  if (
    !isRecord(payload)
    || payload.schema !== 'aqi-memory-promotion-read/v0'
    || payload.authority !== 'aqi-home-core'
    || typeof payload.exists !== 'boolean'
    || payload.candidateId !== candidateId
  ) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  if (!payload.exists) return { candidateId, exists: false };
  const result: MemoryPromotionRead = {
    candidateId,
    exists: true,
    lifecycle: promotionLifecycle(payload.lifecycle)
  };
  if (payload.memoryId !== undefined) result.memoryId = requiredString(payload.memoryId);
  if (payload.completedAt !== undefined) {
    if (!Number.isFinite(payload.completedAt)) {
      throw new AqiMemoryInboxApiError('invalid_response');
    }
    result.completedAt = payload.completedAt as number;
  }
  return result;
}

function exactEvidenceText(content: unknown) {
  if (!isRecord(content)) return null;
  if (content.content_type === 'code' && typeof content.text === 'string') {
    return content.text;
  }
  if (
    (content.content_type === 'text' || content.content_type === 'multimodal_text')
    && Array.isArray(content.parts)
  ) {
    const parts = content.parts.map((part) => {
      if (typeof part === 'string') return part;
      if (isRecord(part) && typeof part.text === 'string') return part.text;
      throw new AqiMemoryInboxApiError('invalid_response');
    });
    return parts.join('\n');
  }
  return null;
}

export async function readCandidateSourceEvidence(
  candidateId: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<MemoryEvidenceSource[]> {
  const { response, payload } = await fetchJson(
    `/api/memory/candidates/${encodeURIComponent(candidateId)}/source-evidence`,
    {},
    options.fetchImpl
  );
  if (!response.ok) throw mapFailure(response.status);
  if (
    !isRecord(payload)
    || payload.schema !== 'aqi-memory-candidate-source-evidence/v0'
    || payload.authority !== 'aqi-home-core'
    || payload.candidateId !== candidateId
    || !Array.isArray(payload.sources)
  ) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return payload.sources.map((source): MemoryEvidenceSource => {
    if (!isRecord(source) || source.status !== 'resolved') return { status: 'unavailable' };
    if (source.contextState === 'membership_required') {
      if (!Number.isInteger(source.membershipCount)) {
        throw new AqiMemoryInboxApiError('invalid_response');
      }
      return {
        status: 'membership_required',
        membershipCount: source.membershipCount as number
      };
    }
    if (
      (source.contextState !== 'resolved' && source.contextState !== 'context_missing')
      || (source.role !== 'user' && source.role !== 'assistant')
    ) {
      throw new AqiMemoryInboxApiError('invalid_response');
    }
    const text = exactEvidenceText(source.content);
    if (text === null) return { status: 'unavailable' };
    return {
      status: 'resolved',
      role: source.role,
      text,
      contextState: source.contextState
    };
  });
}

export async function reviewMemoryCandidate(
  candidateId: string,
  action: 'approve' | 'reject',
  options: { fetchImpl?: typeof fetch } = {}
) {
  const { response, payload } = await fetchJson(
    `/api/memory/candidates/${encodeURIComponent(candidateId)}/${action}`,
    { method: 'POST' },
    options.fetchImpl
  );
  if (!response.ok) throw mapFailure(response.status);
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.candidate)) {
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return candidateDetail(payload.candidate);
}

export async function promoteMemoryCandidate(
  candidateId: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<MemoryPromotionRead> {
  const { response, payload } = await fetchJson(
    `/api/memory/candidates/${encodeURIComponent(candidateId)}/promote`,
    { method: 'POST' },
    options.fetchImpl
  );
  if (response.status === 401 || response.status === 404 || response.status === 503) {
    throw mapFailure(response.status);
  }
  if (
    !isRecord(payload)
    || payload.schema !== 'aqi-memory-promotion-status/v0'
    || payload.authority !== 'aqi-home-core'
    || payload.candidateId !== candidateId
  ) {
    if (!response.ok) throw mapFailure(response.status);
    throw new AqiMemoryInboxApiError('invalid_response');
  }
  return {
    candidateId,
    exists: true,
    lifecycle: promotionLifecycle(payload.lifecycle),
    ...(payload.memoryId !== undefined ? { memoryId: requiredString(payload.memoryId) } : {}),
    ...(payload.completedAt !== undefined && Number.isFinite(payload.completedAt)
      ? { completedAt: payload.completedAt as number }
      : {})
  };
}
