import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '../types/domain';
import { buildServerHeaders } from './mcpRuntimeTransport';

function serverWithHeaders(
  headers: McpServerConfig['headers']
): McpServerConfig {
  return {
    id: 'mcp-test',
    handle: 'mcp-test',
    name: 'MCP Test',
    description: '',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers,
    tools: [],
    isActive: true
  };
}

describe('buildServerHeaders', () => {
  it('accepts Authorization', () => {
    const headers = buildServerHeaders(
      serverWithHeaders([
        {
          id: 'auth',
          key: 'Authorization',
          value: 'Bearer secret'
        }
      ])
    );

    expect(headers.get('Authorization')).toBe('Bearer secret');
  });

  it('trims a valid header name', () => {
    const headers = buildServerHeaders(
      serverWithHeaders([
        {
          id: 'auth',
          key: '  Authorization  ',
          value: 'Bearer secret'
        }
      ])
    );

    expect(headers.get('Authorization')).toBe('Bearer secret');
  });

  it('ignores an empty header name', () => {
    expect(() =>
      buildServerHeaders(
        serverWithHeaders([
          {
            id: 'empty',
            key: '   ',
            value: 'unused'
          }
        ])
      )
    ).not.toThrow();
  });

  it('rejects an invalid header name with a clear error', () => {
    expect(() =>
      buildServerHeaders(
        serverWithHeaders([
          {
            id: 'bad',
            key: 'Authorization:',
            value: 'Bearer secret'
          }
        ])
      )
    ).toThrow('Invalid MCP request header name');
  });

  it('rejects embedded newline characters', () => {
    expect(() =>
      buildServerHeaders(
        serverWithHeaders([
          {
            id: 'bad',
            key: 'Authorization\\nX-Test',
            value: 'Bearer secret'
          }
        ])
      )
    ).toThrow('Invalid MCP request header name');
  });
});
