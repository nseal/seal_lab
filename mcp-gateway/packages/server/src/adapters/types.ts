/** Upstream credentials. MVP supports a single bearer token pasted by the admin. */
export interface Credentials {
  token: string;
}

export type TenantCheckResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * An adapter describes how to talk to one kind of upstream MCP server:
 * how to authenticate, and which tool arguments carry a tenant ID so the
 * gateway can enforce the endpoint's allowed tenant.
 */
export interface UpstreamAdapter {
  type: string;
  displayName: string;
  defaultUpstreamUrl?: string;
  /** Argument names (checked recursively) that carry a tenant/workspace ID. */
  tenantParamNames: string[];
  /** The param injected when a tool accepts a tenant ID but the caller omitted it. */
  primaryTenantParam: string;
  buildAuthHeaders(credentials: Credentials): Record<string, string>;
  /**
   * Validates (and possibly rewrites) tool-call arguments against the allowed
   * tenant. `inputSchema` is the tool's JSON schema from the upstream
   * tools/list, used to decide whether to inject the tenant param.
   */
  enforceTenant(
    toolName: string,
    args: Record<string, unknown>,
    allowedTenantId: string,
    inputSchema?: Record<string, unknown>,
  ): TenantCheckResult;
}

/**
 * Shared enforcement logic: reject any declared tenant param (found at any
 * nesting depth) that doesn't match the allowed tenant, and inject the primary
 * tenant param when the tool's schema accepts it and the caller omitted it.
 */
export function enforceTenantByParams(
  adapter: Pick<UpstreamAdapter, 'tenantParamNames' | 'primaryTenantParam'>,
  args: Record<string, unknown>,
  allowedTenantId: string,
  inputSchema?: Record<string, unknown>,
): TenantCheckResult {
  const violation = findTenantViolation(args, adapter.tenantParamNames, allowedTenantId);
  if (violation) {
    return {
      ok: false,
      reason: `Argument "${violation.path}" refers to tenant "${violation.value}" but this endpoint only allows tenant "${allowedTenantId}"`,
    };
  }

  const nextArgs = { ...args };
  const schemaProps = (inputSchema?.properties ?? {}) as Record<string, unknown>;
  if (adapter.primaryTenantParam in schemaProps && nextArgs[adapter.primaryTenantParam] === undefined) {
    nextArgs[adapter.primaryTenantParam] = allowedTenantId;
  }
  return { ok: true, args: nextArgs };
}

function findTenantViolation(
  value: unknown,
  paramNames: string[],
  allowedTenantId: string,
  path = '',
): { path: string; value: string } | undefined {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findTenantViolation(value[i], paramNames, allowedTenantId, `${path}[${i}]`);
      if (hit) return hit;
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (paramNames.includes(key)) {
      if (typeof child === 'string' && child !== allowedTenantId) {
        return { path: childPath, value: child };
      }
      if (typeof child === 'number' && String(child) !== allowedTenantId) {
        return { path: childPath, value: String(child) };
      }
    }
    const hit = findTenantViolation(child, paramNames, allowedTenantId, childPath);
    if (hit) return hit;
  }
  return undefined;
}
