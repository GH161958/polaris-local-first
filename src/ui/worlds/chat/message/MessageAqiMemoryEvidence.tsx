import { useState } from 'react';
import {
  readAqiMemorySourceEvidenceForMessage,
  type AqiMemorySourceEvidenceContent,
  type AqiMemorySourceEvidenceForMessageResult,
  type AqiMemorySourceEvidenceSource
} from '../../../../app/chat/aqiMemorySourceEvidence';
import { validateAqiMemoryReceipt } from '../../../../engines/chat-api/aqiMemoryReceipt';
import type { ChatMessage } from '../../../../types/domain';

type EvidenceMessage = Pick<ChatMessage, 'id' | 'role' | 'aqiMemoryReceipt'>;
type EvidenceReader = (message: EvidenceMessage) => Promise<AqiMemorySourceEvidenceForMessageResult>;

export type MessageAqiMemoryEvidenceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; result: AqiMemorySourceEvidenceForMessageResult }
  | { status: 'failed' };

type MessageAqiMemoryEvidenceProps = {
  message: EvidenceMessage;
  reader?: EvidenceReader;
};

type MessageAqiMemoryEvidenceViewProps = {
  state: MessageAqiMemoryEvidenceState;
  onRead: () => void;
};

export function hasAqiMemorySourceEvidenceAction(message: EvidenceMessage) {
  if (message.role !== 'assistant' || !message.aqiMemoryReceipt) return false;
  try {
    return validateAqiMemoryReceipt(message.aqiMemoryReceipt).memoryRefs.length > 0;
  } catch {
    return false;
  }
}

export async function loadAqiMemorySourceEvidence(
  message: EvidenceMessage,
  reader: EvidenceReader = readAqiMemorySourceEvidenceForMessage
) {
  return await reader(message);
}

function ExactContent({ content }: { content: AqiMemorySourceEvidenceContent }) {
  if (!content) return <p className="message-aqi-source-unavailable">暂时无法读取这条原话。</p>;
  if (content.content_type === 'code') {
    return <pre className="message-aqi-source-code"><code>{content.text}</code></pre>;
  }
  if (content.content_type === 'text') {
    return (
      <div className="message-aqi-source-content">
        {content.parts.map((part, index) => <p key={index}>{part}</p>)}
      </div>
    );
  }
  return (
    <div className="message-aqi-source-content">
      {content.parts.map((part, index) => (
        <p key={index}>{typeof part === 'string' ? part : part.text}</p>
      ))}
    </div>
  );
}

function SourceEvidence({ source }: { source: AqiMemorySourceEvidenceSource }) {
  if (source.status !== 'resolved') {
    return <p className="message-aqi-source-unavailable">暂时无法读取这条原话。</p>;
  }
  if (source.contextState === 'membership_required') {
    return <p className="message-aqi-source-notice">有多个可能的原话上下文，暂未自动选择。</p>;
  }
  return (
    <div className="message-aqi-source-exact" data-context-state={source.contextState}>
      <span className="message-aqi-source-role">{source.role === 'user' ? '用户' : '助手'}</span>
      <ExactContent content={source.content} />
      {source.contextState === 'context_missing' ? (
        <p className="message-aqi-source-context-note">暂时无法读取周边上下文。</p>
      ) : null}
    </div>
  );
}

function LoadedEvidence({ result }: { result: AqiMemorySourceEvidenceForMessageResult }) {
  if (result.memories.length === 0) {
    return <p className="message-aqi-source-unavailable">暂时无法读取这条原话。</p>;
  }
  return (
    <div className="message-aqi-source-memory-list">
      {result.memories.map((memory, memoryIndex) => (
        <article key={memory.memoryId} className="message-aqi-source-memory" data-memory-id={memory.memoryId}>
          <h4>记忆 {memoryIndex + 1}</h4>
          {memory.status === 'failed' ? (
            <p className="message-aqi-source-unavailable">暂时无法读取这条原话。</p>
          ) : memory.evidence.sources.length === 0 ? (
            <p className="message-aqi-source-empty">暂无原话链接</p>
          ) : (
            <div className="message-aqi-source-list">
              {memory.evidence.sources.map((source, sourceIndex) => (
                <div key={sourceIndex} className="message-aqi-source-item">
                  <SourceEvidence source={source} />
                </div>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function MessageAqiMemoryEvidenceView({
  state,
  onRead
}: MessageAqiMemoryEvidenceViewProps) {
  const loading = state.status === 'loading';
  return (
    <div className="message-aqi-source-evidence" data-state={state.status}>
      <button
        type="button"
        className="message-aqi-source-trigger"
        onClick={onRead}
        disabled={loading}
        aria-expanded={state.status === 'loaded'}
      >
        {loading ? '正在读取…' : '查看当时原话'}
      </button>
      {state.status === 'loaded' ? (
        <div className="message-aqi-source-panel"><LoadedEvidence result={state.result} /></div>
      ) : state.status === 'failed' ? (
        <div className="message-aqi-source-panel">
          <p className="message-aqi-source-unavailable">暂时无法读取这条原话。</p>
        </div>
      ) : null}
    </div>
  );
}

export function MessageAqiMemoryEvidence({
  message,
  reader = readAqiMemorySourceEvidenceForMessage
}: MessageAqiMemoryEvidenceProps) {
  const [state, setState] = useState<MessageAqiMemoryEvidenceState>({ status: 'idle' });

  if (!hasAqiMemorySourceEvidenceAction(message)) return null;

  const handleRead = async () => {
    if (state.status === 'loading' || state.status === 'loaded') return;
    setState({ status: 'loading' });
    try {
      const result = await loadAqiMemorySourceEvidence(message, reader);
      if (result.status === 'no_receipt' || result.status === 'invalid_receipt' || result.status === 'no_refs') {
        setState({ status: 'failed' });
        return;
      }
      setState({ status: 'loaded', result });
    } catch {
      setState({ status: 'failed' });
    }
  };

  return <MessageAqiMemoryEvidenceView state={state} onRead={() => { void handleRead(); }} />;
}
