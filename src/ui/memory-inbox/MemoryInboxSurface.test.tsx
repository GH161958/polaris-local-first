import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  MemoryCandidateDetail,
  MemoryPromotionRead
} from '../../app/memory/aqiMemoryInboxApi';
import {
  MemoryInboxView,
  PROMOTION_LABELS,
  type MemoryInboxViewProps
} from './MemoryInboxSurface';

const candidate: MemoryCandidateDetail = {
  candidateId: 'formation_candidate_11111111111111111111111111111111',
  title: '阿栖带回的一件小事',
  content: '这是候选内容，不是数据库管理界面。',
  lifecycle: 'pending',
  createdAt: 100,
  memorablePhrases: ['门可以换，家不要丢'],
  sharedSymbols: ['小雪豹']
};

function props(patch: Partial<MemoryInboxViewProps> = {}): MemoryInboxViewProps {
  return {
    filter: 'pending',
    candidates: [candidate],
    selected: candidate,
    promotion: { candidateId: candidate.candidateId, exists: false },
    evidence: { status: 'idle' },
    loadingList: false,
    loadingDetail: false,
    actionBusy: false,
    error: null,
    nextOffset: null,
    onFilter: vi.fn(),
    onSelect: vi.fn(),
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onPromote: vi.fn(),
    onReadEvidence: vi.fn(),
    onReload: vi.fn(),
    onLoadMore: vi.fn(),
    onClose: vi.fn(),
    ...patch
  };
}

function render(patch: Partial<MemoryInboxViewProps> = {}) {
  return renderToStaticMarkup(<MemoryInboxView {...props(patch)} />);
}

describe('MemoryInboxView', () => {
  it('renders a calm Inbox with pending review actions and retained meaning fields', () => {
    const html = render();
    expect(html).toContain('记忆收件箱');
    expect(html).toContain('留下');
    expect(html).toContain('不要');
    expect(html).not.toContain('真正记住');
    expect(html).toContain('门可以换，家不要丢');
    expect(html).toContain('小雪豹');
  });

  it('keeps approval separate from explicit promotion', () => {
    const approved = { ...candidate, lifecycle: 'approved' as const };
    const html = render({ selected: approved, candidates: [approved] });
    expect(html).toContain('已批准，但还没有进入长期记忆');
    expect(html).toContain('真正记住');
    expect(html).not.toContain('>留下<');

    const alreadyStarted = render({
      selected: approved,
      candidates: [approved],
      promotion: {
        candidateId: approved.candidateId,
        exists: true,
        lifecycle: 'prepared'
      }
    });
    expect(alreadyStarted).toContain(PROMOTION_LABELS.prepared);
    expect(alreadyStarted).not.toContain('真正记住');
  });

  it('renders rejected and every partial/failure Promotion state truthfully', () => {
    const rejected = { ...candidate, lifecycle: 'rejected' as const };
    const rejectedHtml = render({ selected: rejected, candidates: [rejected] });
    expect(rejectedHtml).toContain('已经放下');
    expect(rejectedHtml).not.toContain('真正记住');

    for (const lifecycle of [
      'dispatching',
      'indeterminate',
      'failed',
      'source_attachment_pending',
      'source_attachment_failed',
      'source_attachment_indeterminate'
    ] as const) {
      const promotion: MemoryPromotionRead = {
        candidateId: candidate.candidateId,
        exists: true,
        lifecycle,
        ...(lifecycle.startsWith('source_attachment_') ? { memoryId: 'memory-safe' } : {})
      };
      expect(render({ promotion })).toContain(PROMOTION_LABELS[lifecycle]);
    }
  });

  it('shows succeeded as already remembered without exposing backend identity', () => {
    const html = render({
      promotion: {
        candidateId: candidate.candidateId,
        exists: true,
        lifecycle: 'succeeded',
        memoryId: 'private-backend-identity',
        completedAt: 200
      }
    });
    expect(html).toContain('✓ 已经记住');
    expect(html).not.toContain('private-backend-identity');
  });

  it('renders exact evidence only after a loaded read and preserves ambiguity', () => {
    const idle = render();
    expect(idle).toContain('查看当时原话');
    expect(idle).not.toContain('exact &lt;original&gt;');

    const loaded = render({
      evidence: {
        status: 'loaded',
        sources: [
          { status: 'resolved', role: 'user', text: 'exact <original> 原话', contextState: 'resolved' },
          { status: 'membership_required', membershipCount: 2 }
        ]
      }
    });
    expect(loaded).toContain('exact &lt;original&gt; 原话');
    expect(loaded).toContain('有 2 个可见上下文，尚未选择；没有自动猜测。');
  });

  it('disables duplicate review/promotion actions while a request is active', () => {
    const approved = { ...candidate, lifecycle: 'approved' as const };
    const html = render({ selected: approved, candidates: [approved], actionBusy: true });
    expect(html).toContain('正在记住…');
    expect(html).toContain('disabled');
  });

  it('renders auth and request failures without optimistic success', () => {
    const html = render({ error: '请先连接 Aqi Home，再重新读取。' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('请先连接 Aqi Home');
    expect(html).not.toContain('✓ 已经记住');
  });
});
