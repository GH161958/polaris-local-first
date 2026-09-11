import { describe, expect, it } from 'vitest';
import { executeEnvironmentDirectoryAction, type EnvironmentDirectorySnapshot } from './environmentDirectory';

const baseSnapshot: EnvironmentDirectorySnapshot = {
  activeWorld: 'chat',
  collectionShelf: 'code',
  activeConversation: {
    id: 'conv-1',
    title: '现在线',
    collaboratorId: 'persona-1',
    activeProjectId: 'project-1'
  },
  activeCollaboratorName: 'Pharos',
  activeCardId: 'card-1',
  cards: [{
    id: 'card-1',
    title: '设置说明卡',
    language: 'markdown',
    kind: 'card',
    tags: ['settings']
  }],
  imageCards: [],
  roomProjects: [{
    id: 'project-1',
    title: 'Aru Native Mode',
    slug: 'aru-native-mode',
    entryFileId: 'file-1'
  }],
  projectFiles: [{
    id: 'file-1',
    projectId: 'project-1',
    filePath: 'src/nativeMode.ts',
    language: 'typescript',
    fileRole: 'logic',
    updatedAt: 123
  }],
  workspaceReferenceDocs: [{
    id: 'ref-1',
    projectId: 'project-1',
    title: '设计意图',
    summary: '环境目录不是操作系统',
    source: 'manual'
  }],
  memoryDocs: [{
    id: 'mem-1',
    title: '用户偏好',
    summary: '少兜底，边界清楚',
    updatedAt: 456
  }],
  providers: [{
    id: 'provider-1',
    name: 'OpenAI Compatible',
    protocol: 'openai-responses',
    model: 'gpt-5'
  }],
  activeProviderId: 'provider-1',
  mcpServers: [{
    id: 'mcp-1',
    name: 'Docs',
    isActive: true,
    tools: [{
      name: 'read_doc',
      description: 'Read docs',
      inputSchema: {},
      enabled: true
    }]
  }],
  webSearch: {
    provider: 'bingLocal',
    apiKey: '',
    bochaSummary: true,
    bochaFreshness: 'noLimit',
    customEndpoint: '',
    customAdapter: 'tavily',
    customLabel: ''
  },
  desktopLocalHost: null,
  attachmentCount: 0,
  archiveAttachmentCount: 0,
  imageAttachmentCount: 0,
  calendarAvailable: false,
  calendarWriteAvailable: false,
  imageGenerationAvailable: false,
  memorySearchAvailable: true
};

describe('executeEnvironmentDirectoryAction', () => {
  it('lists the root as a directory of environment surfaces rather than instructions', () => {
    const result = executeEnvironmentDirectoryAction(baseSnapshot, {
      kind: 'listEnvironmentNodes'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detailText).toContain('environment/settings');
    expect(result.detailText).toContain('environment/workspace');
    expect(result.detailText).toContain('节点是取景索引，不是写入口');
  });

  it('inspects a workspace node with real follow-up tools', () => {
    const result = executeEnvironmentDirectoryAction(baseSnapshot, {
      kind: 'inspectEnvironmentNode',
      nodeId: 'environment/workspace'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detailText).toContain('当前工作区：Aru Native Mode');
    expect(result.detailText).toContain('tool=listProjectFiles');
    expect(result.detailText).toContain('environment/workspace/file/file-1');
  });

  it('searches by natural language without materializing the whole tree into the request', () => {
    const result = executeEnvironmentDirectoryAction(baseSnapshot, {
      kind: 'searchEnvironmentNodes',
      query: 'provider'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detailText).toContain('environment/settings/provider');
    expect(result.detailText).toContain('OpenAI Compatible');
  });

  it('does not advertise unavailable native Memory read tools', () => {
    const result = executeEnvironmentDirectoryAction({
      ...baseSnapshot,
      memoryDocs: [],
      memorySearchAvailable: false
    }, {
      kind: 'inspectEnvironmentNode',
      nodeId: 'environment/memory'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.detailText).toContain('memorySearchAvailable=false');
    expect(result.detailText).not.toContain('tool=searchMemory');
    expect(result.detailText).not.toContain('tool=readMemoryDoc');
    expect(result.detailText).not.toContain('tool=openMemorySource');
  });
});
