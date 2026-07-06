import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { Repo } from '../db/repo.js';
import { getAdapter } from '../adapters/registry.js';
import { recordToolCall } from '../audit.js';
import { evaluateToolCall, filterTools } from './policy.js';
import type { UpstreamPool } from './upstream.js';

export interface GatewayDeps {
  repo: Repo;
  pool: UpstreamPool;
}

/**
 * Builds the MCP server one client session talks to. Every request re-reads
 * the endpoint from the DB so admin changes (allowlist, tenant, disable)
 * apply to live sessions immediately.
 */
export function buildEndpointServer(deps: GatewayDeps, endpointId: string): Server {
  const server = new Server(
    { name: 'mcp-gateway', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const requireEndpoint = () => {
    const endpoint = deps.repo.getEndpoint(endpointId);
    if (!endpoint || !endpoint.enabled) {
      throw new McpError(ErrorCode.InvalidRequest, 'This endpoint is disabled or has been removed');
    }
    return endpoint;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const endpoint = requireEndpoint();
    const tools = await deps.pool.listTools(endpoint);
    return { tools: filterTools(endpoint, tools) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const endpoint = requireEndpoint();
    const adapter = getAdapter(endpoint.adapterType);
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    let inputSchema: Record<string, unknown> | undefined;
    try {
      const tools = await deps.pool.listTools(endpoint);
      inputSchema = tools.find((t) => t.name === toolName)?.inputSchema;
    } catch {
      // Schema lookup is best-effort; enforcement still validates existing args.
    }

    const decision = evaluateToolCall(endpoint, adapter, toolName, args, inputSchema);
    if (!decision.allowed) {
      recordToolCall(deps.repo, {
        endpointId: endpoint.id,
        toolName,
        decision: decision.decision,
        detail: decision.reason,
        args,
      });
      if (decision.decision === 'denied_tool') {
        throw new McpError(ErrorCode.InvalidParams, decision.reason);
      }
      // Tenant violations come back as a tool error so the calling model can
      // see why the call was blocked and correct itself.
      return {
        isError: true,
        content: [{ type: 'text', text: `Blocked by gateway policy: ${decision.reason}` }],
      };
    }

    try {
      const result = await deps.pool.callTool(endpoint, toolName, decision.args);
      recordToolCall(deps.repo, {
        endpointId: endpoint.id,
        toolName,
        decision: 'allowed',
        args: decision.args,
      });
      return result;
    } catch (err) {
      recordToolCall(deps.repo, {
        endpointId: endpoint.id,
        toolName,
        decision: 'error',
        detail: String(err),
        args: decision.args,
      });
      throw new McpError(ErrorCode.InternalError, `Upstream call failed: ${String(err)}`);
    }
  });

  return server;
}
