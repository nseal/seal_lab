import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { EndpointRecord, Repo } from '../db/repo.js';
import { getAdapter, listAdapters } from '../adapters/registry.js';
import { generateApiKey, type GatewayConfig } from '../config.js';
import { encryptSecret, hashApiKey, safeEqual } from '../crypto.js';
import type { UpstreamPool } from '../proxy/upstream.js';

const endpointCreateSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'slug must be lowercase letters, digits, hyphens'),
  name: z.string().min(1).max(200),
  adapterType: z.string().min(1),
  upstreamUrl: z.string().url().optional(),
  credentials: z.object({ token: z.string().min(1) }),
  allowedTenantId: z.string().min(1),
  allowedTools: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

const endpointUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  upstreamUrl: z.string().url().optional(),
  credentials: z.object({ token: z.string().min(1) }).optional(),
  allowedTenantId: z.string().min(1).optional(),
  allowedTools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

/** Public shape of an endpoint — credentials never leave the server. */
function serializeEndpoint(e: EndpointRecord) {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    adapterType: e.adapterType,
    upstreamUrl: e.upstreamUrl,
    allowedTenantId: e.allowedTenantId,
    allowedTools: e.allowedTools,
    enabled: e.enabled,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function createAdminRouter(config: GatewayConfig, repo: Repo, pool: UpstreamPool): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (!match || !safeEqual(match[1], config.adminToken)) {
      res.status(401).json({ error: 'Invalid admin token' });
      return;
    }
    next();
  });

  router.get('/adapters', (_req, res) => {
    res.json(
      listAdapters().map((a) => ({
        type: a.type,
        displayName: a.displayName,
        defaultUpstreamUrl: a.defaultUpstreamUrl ?? null,
        tenantParamNames: a.tenantParamNames,
      })),
    );
  });

  router.get('/endpoints', (_req, res) => {
    res.json(repo.listEndpoints().map(serializeEndpoint));
  });

  router.post('/endpoints', (req, res) => {
    const parsed = endpointCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const input = parsed.data;
    let adapter;
    try {
      adapter = getAdapter(input.adapterType);
    } catch (err) {
      res.status(400).json({ error: String(err) });
      return;
    }
    const upstreamUrl = input.upstreamUrl ?? adapter.defaultUpstreamUrl;
    if (!upstreamUrl) {
      res.status(400).json({ error: `upstreamUrl is required for adapter "${adapter.type}"` });
      return;
    }
    if (repo.getEndpointBySlug(input.slug)) {
      res.status(409).json({ error: `slug "${input.slug}" already exists` });
      return;
    }
    const endpoint = repo.createEndpoint({
      slug: input.slug,
      name: input.name,
      adapterType: input.adapterType,
      upstreamUrl,
      credentialsEncrypted: encryptSecret(input.credentials.token, config.masterKey),
      allowedTenantId: input.allowedTenantId,
      allowedTools: input.allowedTools,
      enabled: input.enabled,
    });
    res.status(201).json(serializeEndpoint(endpoint));
  });

  const requireEndpoint = (req: Request, res: Response): EndpointRecord | undefined => {
    const endpoint = repo.getEndpoint(req.params.id);
    if (!endpoint) {
      res.status(404).json({ error: 'Endpoint not found' });
      return undefined;
    }
    return endpoint;
  };

  router.get('/endpoints/:id', (req, res) => {
    const endpoint = requireEndpoint(req, res);
    if (endpoint) res.json(serializeEndpoint(endpoint));
  });

  router.put('/endpoints/:id', (req, res) => {
    const endpoint = requireEndpoint(req, res);
    if (!endpoint) return;
    const parsed = endpointUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { credentials, ...rest } = parsed.data;
    const updated = repo.updateEndpoint(endpoint.id, {
      ...rest,
      ...(credentials ? { credentialsEncrypted: encryptSecret(credentials.token, config.masterKey) } : {}),
    })!;
    pool.drop(endpoint.id);
    res.json(serializeEndpoint(updated));
  });

  router.delete('/endpoints/:id', (req, res) => {
    const endpoint = requireEndpoint(req, res);
    if (!endpoint) return;
    pool.drop(endpoint.id);
    repo.deleteEndpoint(endpoint.id);
    res.status(204).end();
  });

  // Fetches the upstream's live tool list so the admin UI can render
  // allowlist checkboxes.
  router.post('/endpoints/:id/discover-tools', async (req, res) => {
    const endpoint = requireEndpoint(req, res);
    if (!endpoint) return;
    try {
      const tools = await pool.listTools(endpoint, { forceRefresh: true });
      res.json(
        tools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          enabled: endpoint.allowedTools.includes(t.name),
        })),
      );
    } catch (err) {
      res.status(502).json({ error: `Could not reach upstream: ${String(err)}` });
    }
  });

  router.get('/endpoints/:id/api-keys', (req, res) => {
    const endpoint = requireEndpoint(req, res);
    if (!endpoint) return;
    res.json(
      repo.listApiKeys(endpoint.id).map((k) => ({
        id: k.id,
        label: k.label,
        createdAt: k.createdAt,
        revokedAt: k.revokedAt,
      })),
    );
  });

  router.post('/endpoints/:id/api-keys', (req, res) => {
    const endpoint = requireEndpoint(req, res);
    if (!endpoint) return;
    const label = typeof req.body?.label === 'string' ? req.body.label : '';
    const key = generateApiKey();
    const record = repo.createApiKey(endpoint.id, hashApiKey(key), label);
    // The plaintext key is returned exactly once and never stored.
    res.status(201).json({ id: record.id, label: record.label, createdAt: record.createdAt, key });
  });

  router.delete('/endpoints/:id/api-keys/:keyId', (req, res) => {
    const endpoint = requireEndpoint(req, res);
    if (!endpoint) return;
    if (!repo.revokeApiKey(endpoint.id, req.params.keyId)) {
      res.status(404).json({ error: 'API key not found or already revoked' });
      return;
    }
    res.status(204).end();
  });

  router.get('/endpoints/:id/audit-logs', (req, res) => {
    const endpoint = requireEndpoint(req, res);
    if (!endpoint) return;
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    res.json(repo.listAuditLogs(endpoint.id, limit));
  });

  return router;
}
