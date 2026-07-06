import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/**
 * A fake upstream MCP server that behaves like a multi-tenant SaaS MCP
 * (e.g. Asana): tools take a `workspace` argument and will happily return
 * data for ANY workspace — exactly the leak the gateway must prevent.
 */
export function buildMockServer(): McpServer {
  const server = new McpServer({ name: 'mock-upstream', version: '0.0.1' });

  server.registerTool(
    'list_tasks',
    {
      description: 'List tasks in a workspace',
      inputSchema: { workspace: z.string().optional() },
    },
    async ({ workspace }) => ({
      content: [{ type: 'text', text: `tasks in workspace ${workspace ?? '(all workspaces!)'}` }],
    }),
  );

  server.registerTool(
    'create_task',
    {
      description: 'Create a task in a workspace',
      inputSchema: { workspace: z.string().optional(), name: z.string() },
    },
    async ({ workspace, name }) => ({
      content: [{ type: 'text', text: `created "${name}" in workspace ${workspace ?? '(none)'}` }],
    }),
  );

  server.registerTool(
    'delete_everything',
    { description: 'Dangerous admin tool that must stay hidden', inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: 'everything deleted' }] }),
  );

  return server;
}

export interface MockUpstream {
  url: string;
  /** Authorization header values seen on incoming requests. */
  seenAuthHeaders: string[];
  close(): Promise<void>;
}

export async function startMockUpstream(opts: { port?: number; requiredToken?: string } = {}): Promise<MockUpstream> {
  const app = express();
  app.use(express.json());
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const seenAuthHeaders: string[] = [];

  app.post('/mcp', async (req, res) => {
    seenAuthHeaders.push(req.headers.authorization ?? '');
    if (opts.requiredToken && req.headers.authorization !== `Bearer ${opts.requiredToken}`) {
      res.status(401).json({ error: 'bad token' });
      return;
    }
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res, req.body);
      return;
    }
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'expected initialize' });
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => transports.set(sid, transport),
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    await buildMockServer().connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const httpServer: HttpServer = await new Promise((resolve) => {
    const s = app.listen(opts.port ?? 0, () => resolve(s));
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    url: `http://localhost:${port}/mcp`,
    seenAuthHeaders,
    close: () =>
      new Promise((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      }),
  };
}

// Manual run: npm run mock-upstream -w @mcp-gateway/server
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  const port = Number(process.env.MOCK_UPSTREAM_PORT ?? 9797);
  startMockUpstream({ port }).then((mock) => {
    console.log(`Mock upstream MCP server listening at ${mock.url}`);
    console.log('Tools: list_tasks, create_task, delete_everything (tenant param: workspace)');
  });
}
