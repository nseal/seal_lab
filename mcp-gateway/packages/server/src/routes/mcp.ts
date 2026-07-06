import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { EndpointRecord, Repo } from '../db/repo.js';
import { hashApiKey } from '../crypto.js';
import { buildEndpointServer, type GatewayDeps } from '../proxy/mcp-server.js';

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  endpointId: string;
}

/**
 * MCP endpoint for clients: /mcp/:slug (Streamable HTTP).
 * Each endpoint has its own API keys; a key only opens its own endpoint.
 */
export function createMcpRouter(deps: GatewayDeps): Router {
  const router = Router();
  const sessions = new Map<string, SessionEntry>();

  function authenticate(req: Request, res: Response): EndpointRecord | undefined {
    const slug = req.params.slug;
    const auth = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (!match) {
      res.status(401).json(rpcError(-32001, 'Missing Authorization: Bearer <api key>'));
      return undefined;
    }
    const endpoint = deps.repo.findEndpointByApiKeyHash(hashApiKey(match[1]));
    if (!endpoint || endpoint.slug !== slug || !endpoint.enabled) {
      res.status(401).json(rpcError(-32001, 'Invalid API key for this endpoint'));
      return undefined;
    }
    return endpoint;
  }

  router.post('/:slug', async (req, res) => {
    const endpoint = authenticate(req, res);
    if (!endpoint) return;

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.endpointId !== endpoint.id) {
        res.status(404).json(rpcError(-32001, 'Unknown session'));
        return;
      }
      await entry.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json(rpcError(-32000, 'Expected an initialize request to start a session'));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, endpointId: endpoint.id });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    const server = buildEndpointServer(deps, endpoint.id);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const handleSessionRequest = async (req: Request, res: Response) => {
    const endpoint = authenticate(req, res);
    if (!endpoint) return;
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry || entry.endpointId !== endpoint.id) {
      res.status(404).json(rpcError(-32001, 'Unknown session'));
      return;
    }
    await entry.transport.handleRequest(req, res);
  };

  router.get('/:slug', handleSessionRequest);
  router.delete('/:slug', handleSessionRequest);

  return router;
}

function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}
