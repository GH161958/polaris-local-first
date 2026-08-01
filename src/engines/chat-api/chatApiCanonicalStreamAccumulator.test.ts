import { describe, expect, it } from 'vitest';
import type { ReplyAccumulator } from '../provider-runtime/providerRuntimeReplyAccumulator';
import { applyProviderRuntimeStreamEvents } from './chatApiCanonicalStreamAccumulator';

function createAccumulator(): ReplyAccumulator {
  return {
    content: '',
    thinkingText: '',
    toolCalls: []
  };
}

describe('applyProviderRuntimeStreamEvents', () => {
  it('keeps the internal tool-call array dense when the first provider index is nonzero', () => {
    const target = createAccumulator();

    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.start',
      id: 'call-1',
      name: 'readMemoryDoc',
      index: 1
    }]);
    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.delta',
      id: 'call-1',
      argumentsDelta: '{"docId":"memory-doc-1"}',
      index: 1
    }]);

    expect(target.toolCalls).toEqual([{
      id: 'call-1',
      name: 'readMemoryDoc',
      argumentsText: '{"docId":"memory-doc-1"}',
      sourceSpan: {
        transport: 'native',
        index: 1
      }
    }]);
  });

  it('merges later fragments by provider index without materializing skipped slots', () => {
    const target = createAccumulator();

    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.delta',
      id: '',
      argumentsDelta: '{"target":',
      index: 4
    }]);
    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.start',
      id: 'call-4',
      name: 'readProjectFile',
      index: 4
    }, {
      type: 'tool_call.delta',
      id: 'call-4',
      argumentsDelta: '"active"}',
      index: 4
    }]);

    expect(target.toolCalls).toHaveLength(1);
    expect(target.toolCalls?.[0]).toEqual({
      id: 'call-4',
      name: 'readProjectFile',
      argumentsText: '{"target":"active"}',
      sourceSpan: {
        transport: 'native',
        index: 4
      }
    });
  });

  it('keeps parallel id-only tool starts in separate slots', () => {
    const target = createAccumulator();

    applyProviderRuntimeStreamEvents(target, [{
      type: 'tool_call.start',
      id: 'call-a',
      name: 'readMemoryDoc'
    }, {
      type: 'tool_call.start',
      id: 'call-b',
      name: 'readProjectFile'
    }, {
      type: 'tool_call.delta',
      id: 'call-a',
      argumentsDelta: '{"docId":"memory-doc-1"}'
    }, {
      type: 'tool_call.delta',
      id: 'call-b',
      argumentsDelta: '{"target":"active"}'
    }]);

    expect(target.toolCalls?.map((call) => ({
      id: call.id,
      name: call.name,
      argumentsText: call.argumentsText
    }))).toEqual([{
      id: 'call-a',
      name: 'readMemoryDoc',
      argumentsText: '{"docId":"memory-doc-1"}'
    }, {
      id: 'call-b',
      name: 'readProjectFile',
      argumentsText: '{"target":"active"}'
    }]);
  });
});
