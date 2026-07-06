import { randomUUID } from 'node:crypto';
import type { Db } from './schema.js';

export interface EndpointRecord {
  id: string;
  slug: string;
  name: string;
  adapterType: string;
  upstreamUrl: string;
  credentialsEncrypted: string;
  allowedTenantId: string;
  allowedTools: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  endpointId: string;
  keyHash: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export type AuditDecision = 'allowed' | 'denied_tool' | 'denied_tenant' | 'error';

export interface AuditLogRecord {
  id: number;
  endpointId: string;
  toolName: string;
  decision: AuditDecision;
  detail: string;
  argsDigest: string;
  createdAt: string;
}

interface EndpointRow {
  id: string;
  slug: string;
  name: string;
  adapter_type: string;
  upstream_url: string;
  credentials_encrypted: string;
  allowed_tenant_id: string;
  allowed_tools: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToEndpoint(row: EndpointRow): EndpointRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    adapterType: row.adapter_type,
    upstreamUrl: row.upstream_url,
    credentialsEncrypted: row.credentials_encrypted,
    allowedTenantId: row.allowed_tenant_id,
    allowedTools: JSON.parse(row.allowed_tools),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class Repo {
  constructor(private db: Db) {}

  // --- endpoints ---

  createEndpoint(input: {
    slug: string;
    name: string;
    adapterType: string;
    upstreamUrl: string;
    credentialsEncrypted: string;
    allowedTenantId: string;
    allowedTools: string[];
    enabled?: boolean;
  }): EndpointRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO endpoints (id, slug, name, adapter_type, upstream_url, credentials_encrypted, allowed_tenant_id, allowed_tools, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.slug,
        input.name,
        input.adapterType,
        input.upstreamUrl,
        input.credentialsEncrypted,
        input.allowedTenantId,
        JSON.stringify(input.allowedTools),
        input.enabled === false ? 0 : 1,
      );
    return this.getEndpoint(id)!;
  }

  updateEndpoint(
    id: string,
    patch: Partial<{
      name: string;
      upstreamUrl: string;
      credentialsEncrypted: string;
      allowedTenantId: string;
      allowedTools: string[];
      enabled: boolean;
    }>,
  ): EndpointRecord | undefined {
    const existing = this.getEndpoint(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch };
    this.db
      .prepare(
        `UPDATE endpoints SET name = ?, upstream_url = ?, credentials_encrypted = ?, allowed_tenant_id = ?, allowed_tools = ?, enabled = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.upstreamUrl,
        merged.credentialsEncrypted,
        merged.allowedTenantId,
        JSON.stringify(merged.allowedTools),
        merged.enabled ? 1 : 0,
        id,
      );
    return this.getEndpoint(id);
  }

  getEndpoint(id: string): EndpointRecord | undefined {
    const row = this.db.prepare('SELECT * FROM endpoints WHERE id = ?').get(id) as EndpointRow | undefined;
    return row ? rowToEndpoint(row) : undefined;
  }

  getEndpointBySlug(slug: string): EndpointRecord | undefined {
    const row = this.db.prepare('SELECT * FROM endpoints WHERE slug = ?').get(slug) as EndpointRow | undefined;
    return row ? rowToEndpoint(row) : undefined;
  }

  listEndpoints(): EndpointRecord[] {
    const rows = this.db.prepare('SELECT * FROM endpoints ORDER BY created_at').all() as EndpointRow[];
    return rows.map(rowToEndpoint);
  }

  deleteEndpoint(id: string): boolean {
    return this.db.prepare('DELETE FROM endpoints WHERE id = ?').run(id).changes > 0;
  }

  // --- api keys ---

  createApiKey(endpointId: string, keyHash: string, label: string): ApiKeyRecord {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO api_keys (id, endpoint_id, key_hash, label) VALUES (?, ?, ?, ?)')
      .run(id, endpointId, keyHash, label);
    const row = this.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as {
      id: string;
      endpoint_id: string;
      key_hash: string;
      label: string;
      created_at: string;
      revoked_at: string | null;
    };
    return {
      id: row.id,
      endpointId: row.endpoint_id,
      keyHash: row.key_hash,
      label: row.label,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
    };
  }

  listApiKeys(endpointId: string): ApiKeyRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM api_keys WHERE endpoint_id = ? ORDER BY created_at')
      .all(endpointId) as Array<{
      id: string;
      endpoint_id: string;
      key_hash: string;
      label: string;
      created_at: string;
      revoked_at: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      endpointId: r.endpoint_id,
      keyHash: r.key_hash,
      label: r.label,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
    }));
  }

  revokeApiKey(endpointId: string, keyId: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND endpoint_id = ? AND revoked_at IS NULL`,
        )
        .run(keyId, endpointId).changes > 0
    );
  }

  /** Returns the endpoint a valid (non-revoked) API key grants access to. */
  findEndpointByApiKeyHash(keyHash: string): EndpointRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT e.* FROM endpoints e
         JOIN api_keys k ON k.endpoint_id = e.id
         WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
      )
      .get(keyHash) as EndpointRow | undefined;
    return row ? rowToEndpoint(row) : undefined;
  }

  // --- audit logs ---

  addAuditLog(input: {
    endpointId: string;
    toolName: string;
    decision: AuditDecision;
    detail?: string;
    argsDigest?: string;
  }): void {
    this.db
      .prepare(
        'INSERT INTO audit_logs (endpoint_id, tool_name, decision, detail, args_digest) VALUES (?, ?, ?, ?, ?)',
      )
      .run(input.endpointId, input.toolName, input.decision, input.detail ?? '', input.argsDigest ?? '');
  }

  listAuditLogs(endpointId: string, limit = 200): AuditLogRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_logs WHERE endpoint_id = ? ORDER BY id DESC LIMIT ?')
      .all(endpointId, limit) as Array<{
      id: number;
      endpoint_id: string;
      tool_name: string;
      decision: AuditDecision;
      detail: string;
      args_digest: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      endpointId: r.endpoint_id,
      toolName: r.tool_name,
      decision: r.decision,
      detail: r.detail,
      argsDigest: r.args_digest,
      createdAt: r.created_at,
    }));
  }
}
