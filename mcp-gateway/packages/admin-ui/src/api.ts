export interface AdapterInfo {
  type: string;
  displayName: string;
  defaultUpstreamUrl: string | null;
  tenantParamNames: string[];
}

export interface Endpoint {
  id: string;
  slug: string;
  name: string;
  adapterType: string;
  upstreamUrl: string;
  allowedTenantId: string;
  allowedTools: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredTool {
  name: string;
  description: string;
  enabled: boolean;
}

export interface ApiKeyInfo {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface AuditLog {
  id: number;
  toolName: string;
  decision: 'allowed' | 'denied_tool' | 'denied_tenant' | 'error';
  detail: string;
  argsDigest: string;
  createdAt: string;
}

const TOKEN_KEY = 'mcp-gateway-admin-token';

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listAdapters: () => request<AdapterInfo[]>('/adapters'),
  listEndpoints: () => request<Endpoint[]>('/endpoints'),
  getEndpoint: (id: string) => request<Endpoint>(`/endpoints/${id}`),
  createEndpoint: (body: unknown) =>
    request<Endpoint>('/endpoints', { method: 'POST', body: JSON.stringify(body) }),
  updateEndpoint: (id: string, body: unknown) =>
    request<Endpoint>(`/endpoints/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteEndpoint: (id: string) => request<void>(`/endpoints/${id}`, { method: 'DELETE' }),
  discoverTools: (id: string) =>
    request<DiscoveredTool[]>(`/endpoints/${id}/discover-tools`, { method: 'POST' }),
  listApiKeys: (id: string) => request<ApiKeyInfo[]>(`/endpoints/${id}/api-keys`),
  issueApiKey: (id: string, label: string) =>
    request<ApiKeyInfo & { key: string }>(`/endpoints/${id}/api-keys`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  revokeApiKey: (id: string, keyId: string) =>
    request<void>(`/endpoints/${id}/api-keys/${keyId}`, { method: 'DELETE' }),
  listAuditLogs: (id: string) => request<AuditLog[]>(`/endpoints/${id}/audit-logs`),
};
