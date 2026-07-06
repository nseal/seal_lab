import type { Credentials, TenantCheckResult, UpstreamAdapter } from './types.js';
import { enforceTenantByParams } from './types.js';

/**
 * Adapter for Asana's hosted MCP server. The tenant is an Asana workspace GID;
 * the endpoint's credentials must belong to that workspace, and any tool
 * argument naming a workspace is checked against the allowed GID.
 */
export const asanaAdapter: UpstreamAdapter = {
  type: 'asana',
  displayName: 'Asana',
  defaultUpstreamUrl: 'https://mcp.asana.com/sse',
  tenantParamNames: ['workspace', 'workspace_gid', 'workspace_id'],
  primaryTenantParam: 'workspace',

  buildAuthHeaders(credentials: Credentials): Record<string, string> {
    return { Authorization: `Bearer ${credentials.token}` };
  },

  enforceTenant(
    _toolName: string,
    args: Record<string, unknown>,
    allowedTenantId: string,
    inputSchema?: Record<string, unknown>,
  ): TenantCheckResult {
    return enforceTenantByParams(this, args, allowedTenantId, inputSchema);
  },
};
