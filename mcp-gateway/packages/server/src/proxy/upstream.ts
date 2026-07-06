import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { EndpointRecord } from '../db/repo.js';
import { getAdapter } from '../adapters/registry.js';
import { decryptSecret } from '../crypto.js';

export interface UpstreamTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

interface PoolEntry {
  /** Invalidation key: connection is rebuilt when endpoint config changes. */
  configKey: string;
  client: Client;
  toolsCache?: { tools: UpstreamTool[]; fetchedAt: number };
}

const TOOLS_CACHE_TTL_MS = 60_000;

/**
 * Holds one upstream MCP client per endpoint, authenticated with that
 * endpoint's own credentials. Connections are rebuilt when the endpoint
 * configuration changes and dropped on transport failure.
 */
export class UpstreamPool {
  private entries = new Map<string, PoolEntry>();

  constructor(private masterKey: Buffer) {}

  private configKey(endpoint: EndpointRecord): string {
    return `${endpoint.id}:${endpoint.updatedAt}`;
  }

  private async connect(endpoint: EndpointRecord): Promise<Client> {
    const adapter = getAdapter(endpoint.adapterType);
    const token = decryptSecret(endpoint.credentialsEncrypted, this.masterKey);
    const headers = adapter.buildAuthHeaders({ token });
    const url = new URL(endpoint.upstreamUrl);

    // Try Streamable HTTP first, then fall back to legacy SSE.
    const attempts: Array<() => Promise<Client>> = [
      async () => {
        const client = new Client({ name: 'mcp-gateway', version: '0.1.0' });
        await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
        return client;
      },
      async () => {
        const client = new Client({ name: 'mcp-gateway', version: '0.1.0' });
        await client.connect(new SSEClientTransport(url, { requestInit: { headers } }));
        return client;
      },
    ];

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`Failed to connect to upstream ${endpoint.upstreamUrl}: ${String(lastError)}`);
  }

  async getClient(endpoint: EndpointRecord): Promise<Client> {
    const key = this.configKey(endpoint);
    const existing = this.entries.get(endpoint.id);
    if (existing && existing.configKey === key) {
      return existing.client;
    }
    if (existing) {
      await existing.client.close().catch(() => {});
      this.entries.delete(endpoint.id);
    }
    const client = await this.connect(endpoint);
    const entry: PoolEntry = { configKey: key, client };
    client.onclose = () => {
      if (this.entries.get(endpoint.id) === entry) {
        this.entries.delete(endpoint.id);
      }
    };
    this.entries.set(endpoint.id, entry);
    return client;
  }

  /** Runs an upstream call, retrying once on a fresh connection if it fails. */
  private async withClient<T>(endpoint: EndpointRecord, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.getClient(endpoint);
    try {
      return await fn(client);
    } catch (err) {
      this.drop(endpoint.id);
      const retryClient = await this.getClient(endpoint);
      try {
        return await fn(retryClient);
      } catch {
        throw err;
      }
    }
  }

  async listTools(endpoint: EndpointRecord, opts: { forceRefresh?: boolean } = {}): Promise<UpstreamTool[]> {
    const entry = this.entries.get(endpoint.id);
    if (
      !opts.forceRefresh &&
      entry &&
      entry.configKey === this.configKey(endpoint) &&
      entry.toolsCache &&
      Date.now() - entry.toolsCache.fetchedAt < TOOLS_CACHE_TTL_MS
    ) {
      return entry.toolsCache.tools;
    }
    const result = await this.withClient(endpoint, (client) => client.listTools());
    const tools = result.tools as UpstreamTool[];
    const current = this.entries.get(endpoint.id);
    if (current) {
      current.toolsCache = { tools, fetchedAt: Date.now() };
    }
    return tools;
  }

  async callTool(
    endpoint: EndpointRecord,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return (await this.withClient(endpoint, (client) =>
      client.callTool({ name, arguments: args }),
    )) as Record<string, unknown>;
  }

  drop(endpointId: string): void {
    const entry = this.entries.get(endpointId);
    if (entry) {
      this.entries.delete(endpointId);
      void entry.client.close().catch(() => {});
    }
  }

  async closeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(entries.map((e) => e.client.close().catch(() => {})));
  }
}
