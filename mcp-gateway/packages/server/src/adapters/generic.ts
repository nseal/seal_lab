import type { Credentials, TenantCheckResult, UpstreamAdapter } from './types.js';
import { enforceTenantByParams } from './types.js';

/**
 * Adapter for any Streamable HTTP / SSE MCP server that authenticates with a
 * bearer token. Covers common tenant-ish argument names; service-specific
 * adapters should be added when tighter enforcement is needed.
 */
export const genericAdapter: UpstreamAdapter = {
  type: 'generic',
  displayName: 'Generic MCP server',
  tenantParamNames: ['tenant_id', 'tenantId', 'workspace', 'workspace_id', 'workspace_gid', 'org_id', 'team_id'],
  primaryTenantParam: 'tenant_id',

  buildAuthHeaders(credentials: Credentials): Record<string, string> {
    return credentials.token ? { Authorization: `Bearer ${credentials.token}` } : {};
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
