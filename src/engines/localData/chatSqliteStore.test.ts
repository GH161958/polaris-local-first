import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../types/domain';
import type { LocalDataSqliteDriver, LocalDataSqliteQueryRow } from './localDataSqliteBackend';
import { createTypedChatSqliteStore, typedChatSqliteSql } from './chatSqliteStore';

type SqliteStatement = {
  kind: 'execute' | 'query';
  sql: string;
  params: readonly unknown[];
};

type ConversationRow = {
  id: string;
  title: string;
  kind: string;
  collaborator_id: string | null;
  group_room_id: string | null;
  active_project_id: string | null;
  pinned_at: number | null;
  created_at: number;
  updated_at: number;
  metadata_json: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  seq: number;
  role: string;
  content: string;
  reasoning: string;
  created_at: number;
  updated_at: number;
  payload_json: string;
};

function normalizeSql(sql: string) {
  return sql.trim().replace(/\s+/g, ' ');
}

function createConversation(args: {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}): Conversation {
  return {
    id: args.id,
    title: args.title,
    collaboratorId: 'pharos',
    messages: Array.from({ length: args.messageCount }, (_, index) => ({
      id: `${args.id}-m-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `${args.title} message ${index}`,
      timestamp: args.updatedAt - args.messageCount + index + 1
    })),
    pinnedAt: null,
    updatedAt: args.updatedAt
  };
}

function createSqliteDriver(): LocalDataSqliteDriver & {
  conversations: Map<string, ConversationRow>;
  messages: Map<string, MessageRow>;
  statements: SqliteStatement[];
} {
  const conversations = new Map<string, ConversationRow>();
  const messages = new Map<string, MessageRow>();
  const statements: SqliteStatement[] = [];
  let transactionConversations: Map<string, ConversationRow> | null = null;
  let transactionMessages: Map<string, MessageRow> | null = null;

  const activeConversations = () => transactionConversations ?? conversations;
  const activeMessages = () => transactionMessages ?? messages;

  return {
    conversations,
    messages,
    statements,

    async execute(sql: string, params: readonly unknown[] = []) {
      const normalizedSql = normalizeSql(sql);
      statements.push({ kind: 'execute', sql: normalizedSql, params });

      if (
        normalizedSql === typedChatSqliteSql.createConversationTable
        || normalizedSql === typedChatSqliteSql.createMessageTable
        || normalizedSql === typedChatSqliteSql.createConversationUpdatedIndex
        || normalizedSql === typedChatSqliteSql.createMessageConversationSeqIndex
      ) {
        return;
      }
      if (normalizedSql === 'BEGIN IMMEDIATE') {
        transactionConversations = new Map(conversations);
        transactionMessages = new Map(messages);
        return;
      }
      if (normalizedSql === 'COMMIT') {
        if (transactionConversations && transactionMessages) {
          conversations.clear();
          messages.clear();
          for (const [id, row] of transactionConversations) conversations.set(id, row);
          for (const [id, row] of transactionMessages) messages.set(id, row);
          transactionConversations = null;
          transactionMessages = null;
        }
        return;
      }
      if (normalizedSql === 'ROLLBACK') {
        transactionConversations = null;
        transactionMessages = null;
        return;
      }
      if (normalizedSql === typedChatSqliteSql.upsertConversation) {
        const [
          id,
          title,
          kind,
          collaboratorId,
          groupRoomId,
          activeProjectId,
          pinnedAt,
          createdAt,
          updatedAt,
          metadataJson
        ] = params;
        if (
          typeof id !== 'string'
          || typeof title !== 'string'
          || typeof kind !== 'string'
          || typeof createdAt !== 'number'
          || typeof updatedAt !== 'number'
          || typeof metadataJson !== 'string'
        ) {
          throw new Error('invalid conversation params');
        }
        activeConversations().set(id, {
          id,
          title,
          kind,
          collaborator_id: typeof collaboratorId === 'string' ? collaboratorId : null,
          group_room_id: typeof groupRoomId === 'string' ? groupRoomId : null,
          active_project_id: typeof activeProjectId === 'string' ? activeProjectId : null,
          pinned_at: typeof pinnedAt === 'number' ? pinnedAt : null,
          created_at: createdAt,
          updated_at: updatedAt,
          metadata_json: metadataJson
        });
        return;
      }
      if (normalizedSql === typedChatSqliteSql.deleteConversationMessages) {
        const [conversationId] = params;
        if (typeof conversationId !== 'string') throw new Error('invalid delete params');
        for (const [id, message] of activeMessages()) {
          if (message.conversation_id === conversationId) activeMessages().delete(id);
        }
        return;
      }
      if (normalizedSql === typedChatSqliteSql.upsertMessage) {
        const [
          id,
          conversationId,
          seq,
          role,
          content,
          reasoning,
          createdAt,
          updatedAt,
          payloadJson
        ] = params;
        if (
          typeof id !== 'string'
          || typeof conversationId !== 'string'
          || typeof seq !== 'number'
          || typeof role !== 'string'
          || typeof content !== 'string'
          || typeof reasoning !== 'string'
          || typeof createdAt !== 'number'
          || typeof updatedAt !== 'number'
          || typeof payloadJson !== 'string'
        ) {
          throw new Error('invalid message params');
        }
        activeMessages().set(id, {
          id,
          conversation_id: conversationId,
          seq,
          role,
          content,
          reasoning,
          created_at: createdAt,
          updated_at: updatedAt,
          payload_json: payloadJson
        });
        return;
      }

      throw new Error(`unexpected execute SQL: ${normalizedSql}`);
    },

    async query<T extends LocalDataSqliteQueryRow = LocalDataSqliteQueryRow>(
      sql: string,
      params: readonly unknown[] = []
    ): Promise<T[]> {
      const normalizedSql = normalizeSql(sql);
      statements.push({ kind: 'query', sql: normalizedSql, params });

      if (normalizedSql === typedChatSqliteSql.readConversationSummaries) {
        const rows = Array.from(activeConversations().values())
          .sort((left, right) => right.updated_at - left.updated_at || left.id.localeCompare(right.id))
          .map((conversation) => {
            const conversationMessages = Array.from(activeMessages().values())
              .filter((message) => message.conversation_id === conversation.id);
            return {
              ...conversation,
              message_count: conversationMessages.length,
              latest_message_timestamp: Math.max(
                0,
                ...conversationMessages.map((message) => message.updated_at)
              )
            };
          });
        return rows as unknown as T[];
      }
      if (normalizedSql === typedChatSqliteSql.readConversationExists) {
        const [conversationId] = params;
        if (typeof conversationId !== 'string') throw new Error('invalid exists params');
        return activeConversations().has(conversationId)
          ? [{ id: conversationId } as unknown as T]
          : [];
      }
      if (normalizedSql === typedChatSqliteSql.readConversationMetadata) {
        const [conversationId] = params;
        if (typeof conversationId !== 'string') throw new Error('invalid metadata params');
        const row = activeConversations().get(conversationId);
        return row ? [{ metadata_json: row.metadata_json } as unknown as T] : [];
      }
      if (normalizedSql === typedChatSqliteSql.readMessageCount) {
        const [conversationId] = params;
        if (typeof conversationId !== 'string') throw new Error('invalid count params');
        const count = Array.from(activeMessages().values())
          .filter((message) => message.conversation_id === conversationId)
          .length;
        return [{ message_count: count } as unknown as T];
      }
      if (
        normalizedSql === typedChatSqliteSql.readRecentMessages
        || normalizedSql === typedChatSqliteSql.readMessagesBeforeSeq
      ) {
        const [conversationId, beforeSeqOrLimit, maybeLimit] = params;
        if (typeof conversationId !== 'string') throw new Error('invalid window params');
        const beforeSeq = normalizedSql === typedChatSqliteSql.readMessagesBeforeSeq
          ? beforeSeqOrLimit
          : undefined;
        const limit = normalizedSql === typedChatSqliteSql.readMessagesBeforeSeq
          ? maybeLimit
          : beforeSeqOrLimit;
        if (typeof limit !== 'number') throw new Error('invalid window limit');
        const rows = Array.from(activeMessages().values())
          .filter((message) => (
            message.conversation_id === conversationId
            && (typeof beforeSeq !== 'number' || message.seq < beforeSeq)
          ))
          .sort((left, right) => right.seq - left.seq)
          .slice(0, limit);
        return rows as unknown as T[];
      }

      throw new Error(`unexpected query SQL: ${normalizedSql}`);
    }
  };
}

describe('createTypedChatSqliteStore', () => {
  it('writes typed conversation and message rows transactionally', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });

    await store.writeConversations([
      createConversation({ id: 'c-1', title: 'First', updatedAt: 200, messageCount: 2 }),
      createConversation({ id: 'c-2', title: 'Second', updatedAt: 300, messageCount: 1 })
    ]);

    expect(driver.statements.map((statement) => statement.sql)).toEqual(expect.arrayContaining([
      'BEGIN IMMEDIATE',
      typedChatSqliteSql.upsertConversation,
      typedChatSqliteSql.upsertMessage,
      'COMMIT'
    ]));
    expect(driver.conversations.get('c-1')).toMatchObject({
      id: 'c-1',
      title: 'First',
      collaborator_id: 'pharos',
      metadata_json: expect.stringContaining('"collaboratorId":"pharos"')
    });
    expect(Array.from(driver.messages.values()).filter((message) => (
      message.conversation_id === 'c-1'
    ))).toHaveLength(2);
  });

  it('persists and reloads the receipt on its exact assistant message without migration', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });
    const conversation = createConversation({
      id: 'c-receipt',
      title: 'Receipt',
      updatedAt: 200,
      messageCount: 2
    });
    conversation.messages[1] = {
      ...conversation.messages[1],
      aqiMemoryReceipt: {
        schema: 'aqi-memory-receipt/v0',
        authority: 'aqi-home-core',
        identityState: 'resolved',
        memoryRefs: [{ memoryId: 'memory-durable' }]
      }
    };

    await store.writeConversations([conversation]);
    const reloaded = await store.readMessageWindow('c-receipt', { limit: 20 });

    expect(reloaded.status).toBe('loaded');
    expect(reloaded.messages[0]?.aqiMemoryReceipt).toBeUndefined();
    expect(reloaded.messages[1]?.aqiMemoryReceipt).toEqual({
      schema: 'aqi-memory-receipt/v0',
      authority: 'aqi-home-core',
      identityState: 'resolved',
      memoryRefs: [{ memoryId: 'memory-durable' }]
    });
  });

  it('reads conversation summaries from typed rows without message payload scans', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });

    await store.writeConversations([
      createConversation({ id: 'c-1', title: 'First', updatedAt: 200, messageCount: 2 }),
      createConversation({ id: 'c-2', title: 'Second', updatedAt: 300, messageCount: 1 })
    ]);
    const summaries = await store.readConversationSummaries();

    expect(summaries).toEqual([
      expect.objectContaining({ id: 'c-2', messageCount: 1, latestMessageTimestamp: 300 }),
      expect.objectContaining({ id: 'c-1', messageCount: 2, latestMessageTimestamp: 200 })
    ]);
    const summaryQuery = driver.statements.find((statement) => (
      statement.kind === 'query'
      && statement.sql === typedChatSqliteSql.readConversationSummaries
    ));
    expect(summaryQuery?.sql).not.toContain('payload_json');
    expect(summaryQuery?.sql).not.toContain('metadata_json');
  });

  it('preserves durable conversation metadata without loading it during summary reads', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });
    const conversation = {
      ...createConversation({ id: 'c-meta', title: 'Metadata', updatedAt: 500, messageCount: 1 }),
      activeProjectId: 'project-1',
      draft: 'draft survives',
      workspaceLedger: [{
        id: 'ledger-1',
        kind: 'workspace_scope_changed' as const,
        createdAt: 499,
        change: 'entered' as const,
        previousProjectId: null,
        nextProjectId: 'project-1',
        summary: 'Entered project'
      }],
      task: {
        id: 'task-1',
        sourceMessageId: 'c-meta-m-0',
        goal: 'keep metadata',
        title: 'Metadata task',
        status: 'running' as const,
        stage: 'proof',
        steps: [],
        executions: [],
        createdAt: 498,
        updatedAt: 499
      }
    };

    await store.writeConversations([conversation]);
    await store.readConversationSummaries();

    const summaryQuery = driver.statements.find((statement) => (
      statement.kind === 'query'
      && statement.sql === typedChatSqliteSql.readConversationSummaries
    ));
    expect(summaryQuery?.sql).not.toContain('metadata_json');
    await expect(store.readConversationMetadata('c-meta')).resolves.toEqual(expect.objectContaining({
      id: 'c-meta',
      activeProjectId: 'project-1',
      draft: 'draft survives',
      task: expect.objectContaining({ id: 'task-1' }),
      workspaceLedger: [expect.objectContaining({ id: 'ledger-1' })]
    }));
  });

  it('reads recent message windows as partial when older rows remain', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });

    await store.writeConversations([
      createConversation({ id: 'c-1', title: 'Window', updatedAt: 300, messageCount: 3 })
    ]);

    await expect(store.readMessageWindow('c-1', { limit: 2 })).resolves.toEqual({
      status: 'partial',
      expectedCount: 3,
      nextBeforeSeq: 1,
      messages: [
        expect.objectContaining({ id: 'c-1-m-1' }),
        expect.objectContaining({ id: 'c-1-m-2' })
      ]
    });
    await expect(store.readMessageWindow('c-1', { limit: 2, beforeSeq: 1 })).resolves.toEqual({
      status: 'loaded',
      expectedCount: 3,
      nextBeforeSeq: null,
      messages: [
        expect.objectContaining({ id: 'c-1-m-0' })
      ]
    });
  });

  it('separates a missing conversation from a loaded empty conversation', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });

    await store.writeConversations([
      createConversation({ id: 'empty', title: 'Empty', updatedAt: 100, messageCount: 0 })
    ]);

    await expect(store.readMessageWindow('missing', { limit: 20 })).resolves.toEqual({
      status: 'missing',
      messages: [],
      expectedCount: 0,
      nextBeforeSeq: null
    });
    await expect(store.readMessageWindow('empty', { limit: 20 })).resolves.toEqual({
      status: 'loaded',
      messages: [],
      expectedCount: 0,
      nextBeforeSeq: null
    });
  });

  it('throws instead of treating invalid message payload JSON as empty', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });

    await store.writeConversations([
      createConversation({ id: 'c-1', title: 'Bad JSON', updatedAt: 100, messageCount: 1 })
    ]);
    const [row] = driver.messages.values();
    row.payload_json = '{bad-json';

    await expect(store.readMessageWindow('c-1', { limit: 20 }))
      .rejects.toThrow('message payload is invalid');
  });

  it('throws instead of treating invalid conversation metadata JSON as defaults', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });

    await store.writeConversations([
      createConversation({ id: 'c-1', title: 'Bad metadata', updatedAt: 100, messageCount: 1 })
    ]);
    const row = driver.conversations.get('c-1');
    if (!row) throw new Error('missing test conversation');
    row.metadata_json = '{bad-json';

    await expect(store.readConversationMetadata('c-1'))
      .rejects.toThrow('conversation metadata is invalid');
  });

  it('rewrites only the selected conversation message rows', async () => {
    const driver = createSqliteDriver();
    const store = createTypedChatSqliteStore({ driver });

    await store.writeConversations([
      createConversation({ id: 'c-1', title: 'First', updatedAt: 200, messageCount: 3 }),
      createConversation({ id: 'c-2', title: 'Second', updatedAt: 300, messageCount: 2 })
    ]);
    await store.writeConversations([
      createConversation({ id: 'c-1', title: 'First edited', updatedAt: 400, messageCount: 1 })
    ]);

    expect(Array.from(driver.messages.values()).filter((message) => (
      message.conversation_id === 'c-1'
    ))).toHaveLength(1);
    expect(Array.from(driver.messages.values()).filter((message) => (
      message.conversation_id === 'c-2'
    ))).toHaveLength(2);
    await expect(store.readConversationSummaries()).resolves.toEqual([
      expect.objectContaining({ id: 'c-1', title: 'First edited', messageCount: 1 }),
      expect.objectContaining({ id: 'c-2', title: 'Second', messageCount: 2 })
    ]);
  });
});
