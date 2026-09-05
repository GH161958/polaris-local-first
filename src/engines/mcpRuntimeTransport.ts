// Shared transport primitives for the MCP runtime.
//
// The small surface that both transports — streamable HTTP (`mcpRuntimeHttp.ts`)
// and legacy SSE (`mcpRuntimeSse.ts`) — depend on: the protocol-handshake
// identity, the per-request fetch/options shape, server header assembly, and the
// SSE wire-frame parser. No session state, no catalog, no JSON-RPC dispatch.

import type { McpServerConfig } from '../types/domain';

export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_CLIENT_INFO = {
  name: 'Polaris',
  version: '0.1.0'
} as const;

export type McpTransportOptions = {
  server: McpServerConfig;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export type InitializeResult = {
  protocolVersion?: string;
  capabilities?: {
    tools?: unknown;
  };
};

export function getFetchImpl(fetchImpl?: typeof fetch) {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (!resolved) {
    throw new Error('当前环境没有 fetch，无法连接 MCP。');
  }
  return resolved;
}

const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function assertValidHeaderName(name: string) {
  if (!HTTP_HEADER_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid MCP request header name: ${JSON.stringify(name)}`);
  }
}

export function buildServerHeaders(server: McpServerConfig, extraHeaders?: Record<string, string>) {
  const headers = new Headers();
  headers.set('Accept', 'application/json, text/event-stream');

  for (const header of server.headers) {
    const key = header.key.trim();
    if (!key) continue;

    assertValidHeaderName(key);
    headers.set(key, header.value);
  }

  for (const [rawKey, value] of Object.entries(extraHeaders ?? {})) {
    const key = rawKey.trim();
    if (!key) continue;

    assertValidHeaderName(key);
    headers.set(key, value);
  }

  return headers;
}

export function parseSseEvents(text: string) {
  const events: Array<{ event: string; data: string }> = [];
  const normalized = text.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim() || 'message';
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (!dataLines.length) continue;
    events.push({
      event: eventName,
      data: dataLines.join('\n')
    });
  }

  return events;
}
