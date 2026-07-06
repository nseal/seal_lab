import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GatewayConfig } from './config.js';
import { openDb, type Db } from './db/schema.js';
import { Repo } from './db/repo.js';
import { UpstreamPool } from './proxy/upstream.js';
import { createMcpRouter } from './routes/mcp.js';
import { createAdminRouter } from './routes/admin.js';

export interface Gateway {
  app: Express;
  repo: Repo;
  pool: UpstreamPool;
  db: Db;
  close(): Promise<void>;
}

export function createGateway(config: GatewayConfig): Gateway {
  const db = openDb(config.dbPath);
  const repo = new Repo(db);
  const pool = new UpstreamPool(config.masterKey);

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/mcp', createMcpRouter({ repo, pool }));
  app.use('/api/admin', createAdminRouter(config, repo, pool));

  // Serve the built admin UI when it exists (mcp-gateway/packages/admin-ui/dist).
  const here = dirname(fileURLToPath(import.meta.url));
  const adminUiDist = join(here, '..', '..', 'admin-ui', 'dist');
  if (existsSync(adminUiDist)) {
    app.use('/admin', express.static(adminUiDist));
    app.get('/admin/*', (_req, res) => {
      res.sendFile(join(adminUiDist, 'index.html'));
    });
  }

  return {
    app,
    repo,
    pool,
    db,
    async close() {
      await pool.closeAll();
      db.close();
    },
  };
}
