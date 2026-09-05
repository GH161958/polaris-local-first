import { describe, expect, it, vi } from 'vitest';
import { subscribeAqiHomeAuthRequired } from '../chat/aqiHomeAuth';
import {
  AqiMemoryInboxApiError,
  listMemoryCandidates,
  promoteMemoryCandidate,
  readCandidateSourceEvidence,
  readMemoryCandidate,
  readMemoryPromotion,
  reviewMemoryCandidate
} from './aqiMemoryInboxApi';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const candidate = {
  candidateId: 'formation_candidate_11111111111111111111111111111111',
  title: 'Homecoming',
  content: 'A small shared moment.',
  disposition: 'memory',
  resolution: 'high',
  lifecycle: 'approved',
  createdAt: 100,
  sourceMessageIds: ['msg-1'],
  sourceRefs: []
};

describe('Aqi Memory Inbox API', () => {
  it('reads filtered paginated candidates through the same-origin private session path', async () => {
    const fetchImpl = vi.fn(async () => json({
      schema: 'aqi-memory-formation-candidate-list/v0',
      authority: 'aqi-home-core',
      candidates: [candidate],
      page: { limit: 50, offset: 0, total: 1, nextOffset: null }
    }));

    await expect(listMemoryCandidates('approved', 0, { fetchImpl })).resolves.toEqual({
      candidates: [{
        candidateId: candidate.candidateId,
        title: candidate.title,
        content: candidate.content,
        lifecycle: 'approved',
        createdAt: 100
      }],
      page: { offset: 0, total: 1, nextOffset: null }
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/api/memory/candidates?status=approved&limit=50&offset=0'),
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('reads Candidate detail, promotion truth, and exact source evidence independently', async () => {
    const responses = [
      json({
        schema: 'aqi-memory-formation-candidate-review/v0',
        authority: 'aqi-home-core',
        ...candidate,
        memorablePhrases: ['门可以换，家不要丢'],
        sharedSymbols: ['门']
      }),
      json({
        schema: 'aqi-memory-promotion-read/v0',
        authority: 'aqi-home-core',
        candidateId: candidate.candidateId,
        exists: true,
        lifecycle: 'source_attachment_pending',
        memoryId: 'memory-1'
      }),
      json({
        schema: 'aqi-memory-candidate-source-evidence/v0',
        authority: 'aqi-home-core',
        candidateId: candidate.candidateId,
        sources: [{
          status: 'resolved',
          role: 'user',
          content: { content_type: 'text', parts: ['exact 原话'] },
          contextState: 'resolved'
        }]
      })
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);

    await expect(readMemoryCandidate(candidate.candidateId, { fetchImpl })).resolves.toMatchObject({
      title: 'Homecoming',
      memorablePhrases: ['门可以换，家不要丢'],
      sharedSymbols: ['门']
    });
    await expect(readMemoryPromotion(candidate.candidateId, { fetchImpl })).resolves.toEqual({
      candidateId: candidate.candidateId,
      exists: true,
      lifecycle: 'source_attachment_pending',
      memoryId: 'memory-1'
    });
    await expect(readCandidateSourceEvidence(candidate.candidateId, { fetchImpl })).resolves.toEqual([{
      status: 'resolved',
      role: 'user',
      text: 'exact 原话',
      contextState: 'resolved'
    }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps approve separate from promote and retains non-2xx promotion lifecycle truth', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ ok: true, candidate: {
        schema: 'aqi-memory-formation-candidate-review/v0',
        authority: 'aqi-home-core',
        ...candidate
      } }))
      .mockResolvedValueOnce(json({
        schema: 'aqi-memory-promotion-status/v0',
        authority: 'aqi-home-core',
        candidateId: candidate.candidateId,
        lifecycle: 'indeterminate'
      }, 409));

    await expect(reviewMemoryCandidate(candidate.candidateId, 'approve', { fetchImpl }))
      .resolves.toMatchObject({ lifecycle: 'approved' });
    await expect(promoteMemoryCandidate(candidate.candidateId, { fetchImpl })).resolves.toEqual({
      candidateId: candidate.candidateId,
      exists: true,
      lifecycle: 'indeterminate'
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/approve');
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('/promote');
  });

  it('signals the existing auth bootstrap on 401 and rejects malformed Core data', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAqiHomeAuthRequired(listener);
    try {
      const unauthorized = vi.fn(async () => json({ error: { type: 'unauthorized' } }, 401));
      await expect(readMemoryPromotion(candidate.candidateId, { fetchImpl: unauthorized }))
        .rejects.toMatchObject({ kind: 'unauthorized' });
      expect(listener).toHaveBeenCalledOnce();

      const malformed = vi.fn(async () => json({ schema: 'wrong' }));
      await expect(readMemoryCandidate(candidate.candidateId, { fetchImpl: malformed }))
        .rejects.toBeInstanceOf(AqiMemoryInboxApiError);
    } finally {
      unsubscribe();
    }
  });
});
