import { useCallback, useEffect, useState } from 'react';
import {
  AqiMemoryInboxApiError,
  listMemoryCandidates,
  promoteMemoryCandidate,
  readCandidateSourceEvidence,
  readMemoryCandidate,
  readMemoryPromotion,
  reviewMemoryCandidate,
  type MemoryCandidateDetail,
  type MemoryCandidateLifecycle,
  type MemoryCandidateSummary,
  type MemoryEvidenceSource,
  type MemoryPromotionLifecycle,
  type MemoryPromotionRead
} from '../../app/memory/aqiMemoryInboxApi';
import {
  openMemoryInbox,
  subscribeMemoryInboxOpen
} from '../../app/memory/memoryInboxNavigation';
import { Icon } from '../Icon';

type InboxFilter = Extract<MemoryCandidateLifecycle, 'pending' | 'approved' | 'rejected'>;
type EvidenceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; sources: MemoryEvidenceSource[] }
  | { status: 'failed'; message: string };

const FILTER_LABELS: Record<InboxFilter, string> = {
  pending: '待决定',
  approved: '已留下',
  rejected: '已放下'
};

export const PROMOTION_LABELS: Record<MemoryPromotionLifecycle, string> = {
  prepared: '正在准备写入长期记忆',
  dispatching: '正在写入长期记忆',
  indeterminate: '写入结果尚未确认；不会自动重试',
  failed: '没有写入长期记忆',
  source_attachment_pending: 'Memory 已创建，正在连接当时原话',
  source_attachment_failed: 'Memory 已创建，但来源连接失败',
  source_attachment_indeterminate: 'Memory 已创建，但来源连接尚未确认完成',
  succeeded: '已经记住'
};

function errorMessage(error: unknown) {
  if (!(error instanceof AqiMemoryInboxApiError)) return '暂时无法读取 Memory Inbox。';
  if (error.kind === 'unauthorized') return '请先连接 Aqi Home，再重新读取。';
  if (error.kind === 'not_found') return '这条候选已经不存在。';
  if (error.kind === 'conflict') return '当前状态已经变化，请刷新后再试。';
  if (error.kind === 'invalid_response') return 'Aqi Home 返回了无法识别的数据。';
  return 'Aqi Home 暂时不可用，请稍后重试。';
}

function relativeTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function lifecycleLabel(lifecycle: MemoryCandidateLifecycle) {
  if (lifecycle === 'pending') return '等你决定';
  if (lifecycle === 'approved') return '已经留下';
  if (lifecycle === 'rejected') return '已经放下';
  return '已经归档';
}

function promotionCopy(candidate: MemoryCandidateDetail, promotion: MemoryPromotionRead) {
  if (!promotion.exists) {
    return candidate.lifecycle === 'approved'
      ? '已批准，但还没有进入长期记忆'
      : '还没有进入长期记忆';
  }
  return promotion.lifecycle ? PROMOTION_LABELS[promotion.lifecycle] : 'Promotion 状态未知';
}

export type MemoryInboxViewProps = {
  filter: InboxFilter;
  candidates: MemoryCandidateSummary[];
  selected: MemoryCandidateDetail | null;
  promotion: MemoryPromotionRead | null;
  evidence: EvidenceState;
  loadingList: boolean;
  loadingDetail: boolean;
  actionBusy: boolean;
  error: string | null;
  nextOffset: number | null;
  onFilter: (filter: InboxFilter) => void;
  onSelect: (candidateId: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onPromote: () => void;
  onReadEvidence: () => void;
  onReload: () => void;
  onLoadMore: () => void;
  onClose: () => void;
};

function EvidencePanel({ state, onRead }: { state: EvidenceState; onRead: () => void }) {
  return (
    <section className="memory-inbox-evidence" aria-label="当时原话">
      <div className="memory-inbox-section-heading">
        <div>
          <span className="memory-inbox-kicker">SOURCE TRUTH</span>
          <h3>当时原话</h3>
        </div>
        <button type="button" onClick={onRead} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? '正在读取…' : '查看当时原话'}
        </button>
      </div>
      {state.status === 'failed' ? <p className="memory-inbox-error">{state.message}</p> : null}
      {state.status === 'loaded' ? (
        <div className="memory-inbox-evidence-list">
          {state.sources.length === 0 ? <p>没有可读取的来源。</p> : state.sources.map((source, index) => (
            <article key={index} className="memory-inbox-evidence-item">
              {source.status === 'resolved' ? (
                <>
                  <span>{source.role === 'user' ? '用户' : '助手'}</span>
                  <pre>{source.text}</pre>
                  {source.contextState === 'context_missing' ? <small>周边上下文暂不可用。</small> : null}
                </>
              ) : source.status === 'membership_required' ? (
                <p>有 {source.membershipCount} 个可见上下文，尚未选择；没有自动猜测。</p>
              ) : (
                <p>这条来源暂时无法安全读取。</p>
              )}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function MemoryInboxView(props: MemoryInboxViewProps) {
  const {
    filter, candidates, selected, promotion, evidence, loadingList, loadingDetail,
    actionBusy, error, nextOffset, onFilter, onSelect, onApprove, onReject,
    onPromote, onReadEvidence, onReload, onLoadMore, onClose
  } = props;
  return (
    <div className="memory-inbox-backdrop" role="presentation">
      <section className="memory-inbox-surface" role="dialog" aria-modal="true" aria-label="Memory Inbox">
        <header className="memory-inbox-header">
          <div>
            <span className="memory-inbox-kicker">AQI HOME</span>
            <h1>记忆收件箱</h1>
            <p>阿栖带回了什么，由你决定要不要留下。</p>
          </div>
          <button type="button" className="memory-inbox-close" onClick={onClose} aria-label="关闭记忆收件箱">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="memory-inbox-tabs" role="tablist" aria-label="候选状态">
          {(Object.keys(FILTER_LABELS) as InboxFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={filter === item}
              className={filter === item ? 'active' : ''}
              onClick={() => onFilter(item)}
            >
              {FILTER_LABELS[item]}
            </button>
          ))}
        </div>

        {error ? (
          <div className="memory-inbox-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={onReload}>重新读取</button>
          </div>
        ) : null}

        <div className="memory-inbox-layout">
          <aside className="memory-inbox-list" aria-label="Memory candidates">
            {loadingList ? <p className="memory-inbox-empty">正在读取…</p> : null}
            {!loadingList && candidates.length === 0 ? (
              <p className="memory-inbox-empty">这里暂时是空的。</p>
            ) : null}
            {candidates.map((candidate) => (
              <button
                type="button"
                key={candidate.candidateId}
                className={selected?.candidateId === candidate.candidateId ? 'active' : ''}
                onClick={() => onSelect(candidate.candidateId)}
              >
                <span className="memory-inbox-card-topline">
                  <strong>{candidate.title}</strong>
                  <small>{relativeTime(candidate.createdAt)}</small>
                </span>
                <span className="memory-inbox-preview">{candidate.content}</span>
                <span className={`memory-inbox-lifecycle ${candidate.lifecycle}`}>
                  {lifecycleLabel(candidate.lifecycle)}
                </span>
              </button>
            ))}
            {nextOffset !== null ? (
              <button type="button" className="memory-inbox-load-more" onClick={onLoadMore}>
                再看一些
              </button>
            ) : null}
          </aside>

          <article className="memory-inbox-detail">
            {loadingDetail ? <p className="memory-inbox-empty">正在打开这条记忆…</p> : null}
            {!loadingDetail && !selected ? (
              <div className="memory-inbox-detail-placeholder">
                <Icon name="inbox" size={28} />
                <p>从左边选一条，看看阿栖带回了什么。</p>
              </div>
            ) : null}
            {!loadingDetail && selected && promotion ? (
              <>
                <div className="memory-inbox-detail-heading">
                  <span className={`memory-inbox-lifecycle ${selected.lifecycle}`}>
                    {lifecycleLabel(selected.lifecycle)}
                  </span>
                  <h2>{selected.title}</h2>
                  <p>{selected.content}</p>
                </div>

                {selected.memorablePhrases.length > 0 || selected.sharedSymbols.length > 0 ? (
                  <div className="memory-inbox-meaning-grid">
                    {selected.memorablePhrases.length > 0 ? (
                      <section><h3>想保留的话</h3>{selected.memorablePhrases.map((item) => <q key={item}>{item}</q>)}</section>
                    ) : null}
                    {selected.sharedSymbols.length > 0 ? (
                      <section><h3>共同的符号</h3>{selected.sharedSymbols.map((item) => <span key={item}>{item}</span>)}</section>
                    ) : null}
                  </div>
                ) : null}

                <section className={`memory-inbox-promotion ${promotion.lifecycle ?? 'not-started'}`}>
                  <span className="memory-inbox-kicker">LONG-TERM MEMORY</span>
                  <strong>{promotionCopy(selected, promotion)}</strong>
                  {promotion.lifecycle === 'succeeded' ? <span aria-label="已经记住">✓ 已经记住</span> : null}
                </section>

                <div className="memory-inbox-actions">
                  {selected.lifecycle === 'pending' ? (
                    <>
                      <button type="button" className="primary" onClick={onApprove} disabled={actionBusy}>留下</button>
                      <button type="button" onClick={onReject} disabled={actionBusy}>不要</button>
                    </>
                  ) : null}
                  {selected.lifecycle === 'approved' && !promotion.exists ? (
                    <button type="button" className="primary" onClick={onPromote} disabled={actionBusy}>
                      {actionBusy ? '正在记住…' : '真正记住'}
                    </button>
                  ) : null}
                </div>

                <EvidencePanel state={evidence} onRead={onReadEvidence} />
              </>
            ) : null}
          </article>
        </div>
      </section>
    </div>
  );
}

export function MemoryInboxSurface() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>('pending');
  const [candidates, setCandidates] = useState<MemoryCandidateSummary[]>([]);
  const [selected, setSelected] = useState<MemoryCandidateDetail | null>(null);
  const [promotion, setPromotion] = useState<MemoryPromotionRead | null>(null);
  const [evidence, setEvidence] = useState<EvidenceState>({ status: 'idle' });
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  useEffect(() => subscribeMemoryInboxOpen(() => setOpen(true)), []);

  const loadList = useCallback(async (offset = 0) => {
    setLoadingList(true);
    setError(null);
    try {
      const result = await listMemoryCandidates(filter, offset);
      setCandidates((current) => offset === 0
        ? result.candidates
        : [...current, ...result.candidates]);
      setNextOffset(result.page.nextOffset);
    } catch (nextError) {
      setError(errorMessage(nextError));
      if (offset === 0) setCandidates([]);
    } finally {
      setLoadingList(false);
    }
  }, [filter]);

  const selectCandidate = useCallback(async (candidateId: string) => {
    setLoadingDetail(true);
    setError(null);
    setEvidence({ status: 'idle' });
    try {
      const [candidate, nextPromotion] = await Promise.all([
        readMemoryCandidate(candidateId),
        readMemoryPromotion(candidateId)
      ]);
      setSelected(candidate);
      setPromotion(nextPromotion);
    } catch (nextError) {
      setSelected(null);
      setPromotion(null);
      setError(errorMessage(nextError));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setPromotion(null);
    setEvidence({ status: 'idle' });
    void loadList();
  }, [filter, loadList, open]);

  const runReview = async (action: 'approve' | 'reject') => {
    if (!selected || actionBusy) return;
    setActionBusy(true);
    setError(null);
    try {
      await reviewMemoryCandidate(selected.candidateId, action);
      await Promise.all([loadList(), selectCandidate(selected.candidateId)]);
    } catch (nextError) {
      setError(errorMessage(nextError));
      await selectCandidate(selected.candidateId);
    } finally {
      setActionBusy(false);
    }
  };

  const promote = async () => {
    if (!selected || actionBusy || promotion?.exists) return;
    setActionBusy(true);
    setError(null);
    try {
      const nextPromotion = await promoteMemoryCandidate(selected.candidateId);
      setPromotion(nextPromotion);
      await loadList();
    } catch (nextError) {
      setError(errorMessage(nextError));
      try {
        setPromotion(await readMemoryPromotion(selected.candidateId));
      } catch {
        // Keep the last truthful Core projection when refresh is unavailable.
      }
    } finally {
      setActionBusy(false);
    }
  };

  const readEvidence = async () => {
    if (!selected || evidence.status === 'loading') return;
    setEvidence({ status: 'loading' });
    try {
      setEvidence({
        status: 'loaded',
        sources: await readCandidateSourceEvidence(selected.candidateId)
      });
    } catch (nextError) {
      setEvidence({ status: 'failed', message: errorMessage(nextError) });
    }
  };

  return (
    <>
      <button type="button" className="memory-inbox-mobile-entry" onClick={openMemoryInbox}>
        <Icon name="inbox" size={18} />
        <span>记忆收件箱</span>
      </button>
      {open ? (
        <MemoryInboxView
          filter={filter}
          candidates={candidates}
          selected={selected}
          promotion={promotion}
          evidence={evidence}
          loadingList={loadingList}
          loadingDetail={loadingDetail}
          actionBusy={actionBusy}
          error={error}
          nextOffset={nextOffset}
          onFilter={setFilter}
          onSelect={(candidateId) => { void selectCandidate(candidateId); }}
          onApprove={() => { void runReview('approve'); }}
          onReject={() => { void runReview('reject'); }}
          onPromote={() => { void promote(); }}
          onReadEvidence={() => { void readEvidence(); }}
          onReload={() => { void loadList(); }}
          onLoadMore={() => { if (nextOffset !== null) void loadList(nextOffset); }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
