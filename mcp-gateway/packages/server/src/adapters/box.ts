import type { Credentials, TenantCheckResult, UpstreamAdapter } from './types.js';
import { enforceTenantByParams } from './types.js';

/**
 * Adapter for Box's hosted remote MCP server. A Box access token is already
 * scoped to one user/enterprise, so the per-endpoint credential is the main
 * tenant boundary; checking enterprise_id arguments is a safety net for the
 * few tools that accept one.
 */
export const boxAdapter: UpstreamAdapter = {
  type: 'box',
  displayName: 'Box',
  defaultUpstreamUrl: 'https://mcp.box.com',
  tenantParamNames: ['enterprise_id', 'enterpriseId'],
  primaryTenantParam: 'enterprise_id',

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
