import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createGateway, type Gateway } from '../src/app.js';
import type { GatewayConfig } from '../src/config.js';
import { startMockUpstream, type MockUpstream } from './mock-upstream.js';

const ADMIN_TOKEN = 'test-admin-token';
const UPSTREAM_TOKEN = 'upstream-secret-token';
const ALLOWED_WORKSPACE = 'ws-1111';

describe('MCP gateway e2e', () => {
  let mock: MockUpstream;
  let gateway: Gateway;
  let httpServer: HttpServer;
  let baseUrl: string;
  let endpointId: string;
  let apiKey: string;

  async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}/api/admin${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  }

  async function connectClient(key: string): Promise<Client> {
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/asana-team-a`), {
        requestInit: { headers: { Authorization: `Bearer ${key}` } },
      }),
    );
    return client;
  }

  beforeAll(async () => {
    mock = await startMockUpstream({ requiredToken: UPSTREAM_TOKEN });

    const config: GatewayConfig = {
      port: 0,
      dbPath: ':memory:',
      masterKey: randomBytes(32),
      adminToken: ADMIN_TOKEN,
      sqliteJournal: 'WAL',
    };
    gateway = createGateway(config);
    httpServer = await new Promise((resolve) => {
      const s = gateway.app.listen(0, () => resolve(s));
    });
    const address = httpServer.address();
    baseUrl = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    httpServer?.close();
    httpServer?.closeAllConnections();
    await gateway?.close();
    await mock?.close();
  });

  it('rejects admin API calls without the admin token', async () => {
    const res = await fetch(`${baseUrl}/api/admin/endpoints`);
    expect(res.status).toBe(401);
  });

  it('creates an endpoint restricted to one tenant and a tool allowlist', async () => {
    const res = await adminFetch('/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'asana-team-a',
        name: 'Asana – Team A',
        adapterType: 'asana',
        upstreamUrl: mock.url,
        credentials: { token: UPSTREAM_TOKEN },
        allowedTenantId: ALLOWED_WORKSPACE,
        allowedTools: ['list_tasks', 'create_task'],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    endpointId = body.id;
    // Credentials must never be echoed back.
    expect(JSON.stringify(body)).not.toContain(UPSTREAM_TOKEN);
  });

  it('discovers upstream tools for the admin UI', async () => {
    const res = await adminFetch(`/endpoints/${endpointId}/discover-tools`, { method: 'POST' });
    expect(res.status).toBe(200);
    const tools = await res.json();
    const names = tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['create_task', 'delete_everything', 'list_tasks']);
  });

  it('issues an API key (plaintext returned once)', async () => {
    const res = await adminFetch(`/endpoints/${endpointId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ label: 'test client' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    apiKey = body.key;
    expect(apiKey).toMatch(/^mcpgw_/);
  });

  it('rejects MCP connections with a bad API key', async () => {
    await expect(connectClient('mcpgw_wrong-key')).rejects.toThrow();
  });

  it('hides tools that are not on the allowlist', async () => {
    const client = await connectClient(apiKey);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['create_task', 'list_tasks']);
    await client.close();
  });

  it('proxies an allowed call for the allowed tenant', async () => {
    const client = await connectClient(apiKey);
    const result = await client.callTool({
      name: 'list_tasks',
      arguments: { workspace: ALLOWED_WORKSPACE },
    });
    expect(JSON.stringify(result.content)).toContain(`tasks in workspace ${ALLOWED_WORKSPACE}`);
    await client.close();
  });

  it('blocks calls that target another tenant', async () => {
    const client = await connectClient(apiKey);
    const result = await client.callTool({
      name: 'list_tasks',
      arguments: { workspace: 'ws-9999' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Blocked by gateway policy');
    expect(JSON.stringify(result.content)).not.toContain('tasks in workspace ws-9999');
    await client.close();
  });

  it('blocks tenant IDs smuggled in nested arguments', async () => {
    const client = await connectClient(apiKey);
    const result = await client.callTool({
      name: 'create_task',
      arguments: { name: 'x', data: { workspace_gid: 'ws-9999' } },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('Blocked by gateway policy');
    await client.close();
  });

  it('injects the allowed tenant when the caller omits it', async () => {
    const client = await connectClient(apiKey);
    const result = await client.callTool({ name: 'list_tasks', arguments: {} });
    expect(JSON.stringify(result.content)).toContain(`tasks in workspace ${ALLOWED_WORKSPACE}`);
    await client.close();
  });

  it('rejects calls to tools outside the allowlist', async () => {
    const client = await connectClient(apiKey);
    await expect(client.callTool({ name: 'delete_everything', arguments: {} })).rejects.toThrow(
      /not enabled/,
    );
    await client.close();
  });

  it('records every decision in the audit log', async () => {
    const res = await adminFetch(`/endpoints/${endpointId}/audit-logs`);
    const logs = (await res.json()) as Array<{ toolName: string; decision: string }>;
    const decisions = logs.map((l) => `${l.toolName}:${l.decision}`);
    expect(decisions).toContain('list_tasks:allowed');
    expect(decisions).toContain('list_tasks:denied_tenant');
    expect(decisions).toContain('create_task:denied_tenant');
    expect(decisions).toContain('delete_everything:denied_tool');
  });

  it('applies allowlist changes to live sessions immediately', async () => {
    const client = await connectClient(apiKey);
    const update = await adminFetch(`/endpoints/${endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({ allowedTools: ['list_tasks'] }),
    });
    expect(update.status).toBe(200);
    const result = await client.callTool({
      name: 'create_task',
      arguments: { name: 'x' },
    }).catch((err) => err);
    expect(String(result)).toMatch(/not enabled/);
    await client.close();
  });

  it('revoked API keys stop working', async () => {
    const issue = await adminFetch(`/endpoints/${endpointId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ label: 'to revoke' }),
    });
    const { id, key } = await issue.json();
    const client = await connectClient(key);
    await client.close();

    const revoke = await adminFetch(`/endpoints/${endpointId}/api-keys/${id}`, { method: 'DELETE' });
    expect(revoke.status).toBe(204);
    await expect(connectClient(key)).rejects.toThrow();
  });

  it('authenticates to the upstream with the endpoint-specific token', () => {
    expect(mock.seenAuthHeaders.length).toBeGreaterThan(0);
    for (const header of mock.seenAuthHeaders) {
      expect(header).toBe(`Bearer ${UPSTREAM_TOKEN}`);
    }
  });
});
