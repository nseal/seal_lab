import type { EndpointRecord } from '../db/repo.js';
import type { UpstreamAdapter } from '../adapters/types.js';
import type { UpstreamTool } from './upstream.js';

export type PolicyDecision =
  | { allowed: true; args: Record<string, unknown> }
  | { allowed: false; decision: 'denied_tool' | 'denied_tenant'; reason: string };

/** Tools not on the endpoint's allowlist are invisible. Empty allowlist = deny all. */
export function filterTools(endpoint: EndpointRecord, tools: UpstreamTool[]): UpstreamTool[] {
  const allowed = new Set(endpoint.allowedTools);
  return tools.filter((t) => allowed.has(t.name));
}

export function evaluateToolCall(
  endpoint: EndpointRecord,
  adapter: UpstreamAdapter,
  toolName: string,
  args: Record<string, unknown>,
  inputSchema?: Record<string, unknown>,
): PolicyDecision {
  if (!endpoint.allowedTools.includes(toolName)) {
    return {
      allowed: false,
      decision: 'denied_tool',
      reason: `Tool "${toolName}" is not enabled on this endpoint`,
    };
  }
  const tenantCheck = adapter.enforceTenant(toolName, args, endpoint.allowedTenantId, inputSchema);
  if (!tenantCheck.ok) {
    return { allowed: false, decision: 'denied_tenant', reason: tenantCheck.reason };
  }
  return { allowed: true, args: tenantCheck.args };
}
