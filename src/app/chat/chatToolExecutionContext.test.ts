import { describe, expect, it } from 'vitest';
import { buildDirectToolExecutionContext } from './chatToolExecutionContext';

describe('buildDirectToolExecutionContext', () => {
  it('keeps the environment directory in the composed execution surface', () => {
    const collectionState = {
      cards: [],
      imageCards: [],
      roomProjects: [],
      projectFiles: [],
      workspaceReferenceDocs: []
    };
    const context = buildDirectToolExecutionContext({
      chat: {
        conversations: [],
        findConversation: () => null,
        getConversationMessages: () => [],
        setConversationActiveProject: () => undefined,
        readLatestState: () => ({ conversations: [] })
      },
      collection: {
        ...collectionState,
        readLatestState: () => collectionState
      },
      persona: { personas: [] },
      runtime: {
        api: { id: 'test-provider' },
        providers: [],
        mcpServers: [],
        search: {
          provider: 'bingLocal',
          apiKey: '',
          bochaSummary: true,
          bochaFreshness: 'noLimit',
          customEndpoint: '',
          customAdapter: 'tavily',
          customLabel: ''
        },
        imageGeneration: { enabled: false }
      },
      space: {
        activeCardId: null,
        activeWorld: 'chat',
        collectionShelf: 'code',
        setCollectionShelf: () => undefined,
        setWorld: () => undefined,
        setActiveCard: () => undefined,
        spotlightCard: () => undefined,
        applyThemePatch: () => undefined,
        applyThemePreset: () => undefined,
        getCurrentThemeFrame: () => ({})
      },
      memoryActions: {
        appendCollaboratorMemories: () => undefined,
        writeCollaboratorMemoryDoc: () => undefined,
        readCollaboratorMemoryDoc: () => null
      },
      conversationId: 'conversation-test',
      ownerCollaboratorId: null,
      activeProjectId: null
    } as unknown as Parameters<typeof buildDirectToolExecutionContext>[0]);

    expect(context.readEnvironmentDirectory).toBeTypeOf('function');
  });

  it('keeps Polaris native Memory reads out of the Aqi Home route environment directory', async () => {
    const collectionState = {
      cards: [],
      imageCards: [],
      roomProjects: [],
      projectFiles: [],
      workspaceReferenceDocs: []
    };
    const context = buildDirectToolExecutionContext({
      chat: {
        conversations: [],
        findConversation: () => null,
        getConversationMessages: () => [],
        setConversationActiveProject: () => undefined,
        readLatestState: () => ({ conversations: [] })
      },
      collection: {
        ...collectionState,
        readLatestState: () => collectionState
      },
      persona: {
        personas: [{
          id: 'aqi-persona',
          advanced: { providerId: 'aqi-home', modelOverride: '' }
        }]
      },
      runtime: {
        api: {
          id: 'direct-provider',
          baseUrl: 'https://api.openai.com/v1',
          path: '/chat/completions',
          model: 'gpt-test'
        },
        providers: [{
          id: 'aqi-home',
          baseUrl: '/api',
          path: '/chat/completions',
          model: 'aqi-home'
        }],
        mcpServers: [],
        search: {
          provider: 'bingLocal',
          apiKey: '',
          bochaSummary: true,
          bochaFreshness: 'noLimit',
          customEndpoint: '',
          customAdapter: 'tavily',
          customLabel: ''
        },
        imageGeneration: { enabled: false }
      },
      space: {
        activeCardId: null,
        activeWorld: 'chat',
        collectionShelf: 'code',
        setCollectionShelf: () => undefined,
        setWorld: () => undefined,
        setActiveCard: () => undefined,
        spotlightCard: () => undefined,
        applyThemePatch: () => undefined,
        applyThemePreset: () => undefined,
        getCurrentThemeFrame: () => ({})
      },
      memoryActions: {
        listCollaboratorMemoryDocs: () => [{
          id: 'private-native-doc',
          title: 'Native Memory',
          summary: 'must stay local',
          updatedAt: 1
        }],
        searchCollaboratorMemory: () => ({ ok: true, candidates: [] }),
        appendCollaboratorMemories: () => undefined,
        writeCollaboratorMemoryDoc: () => undefined,
        readCollaboratorMemoryDoc: () => null
      },
      conversationId: 'conversation-test',
      ownerCollaboratorId: 'aqi-persona',
      activeProjectId: null
    } as unknown as Parameters<typeof buildDirectToolExecutionContext>[0]);

    const result = await context.readEnvironmentDirectory?.({
      kind: 'inspectEnvironmentNode',
      nodeId: 'environment/memory'
    });

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.detailText).toContain('memorySearchAvailable=false');
    expect(result.detailText).not.toContain('private-native-doc');
    expect(result.detailText).not.toContain('tool=searchMemory');
    expect(result.detailText).not.toContain('tool=readMemoryDoc');
    expect(result.detailText).not.toContain('tool=openMemorySource');
  });
});
