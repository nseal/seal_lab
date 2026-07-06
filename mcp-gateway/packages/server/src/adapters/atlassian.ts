import type { Credentials, TenantCheckResult, UpstreamAdapter } from './types.js';
import { enforceTenantByParams } from './types.js';

/**
 * Adapter for Atlassian's hosted Rovo MCP server (Jira / Confluence).
 * The tenant is a cloudId — the ID of one Atlassian Cloud site, obtainable
 * from https://<site>.atlassian.net/_edge/tenant_info. Tools take a `cloudId`
 * argument, which is checked against the endpoint's allowed tenant.
 */
export const atlassianAdapter: UpstreamAdapter = {
  type: 'atlassian',
  displayName: 'Atlassian (Jira / Confluence)',
  defaultUpstreamUrl: 'https://mcp.atlassian.com/v1/mcp',
  tenantParamNames: ['cloudId', 'cloud_id', 'cloudid'],
  primaryTenantParam: 'cloudId',

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
