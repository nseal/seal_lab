import { randomBytes } from 'node:crypto';

export interface GatewayConfig {
  port: number;
  dbPath: string;
  /** 32-byte key (hex) used to encrypt upstream credentials at rest. */
  masterKey: Buffer;
  /** Bearer token required for /api/admin/*. */
  adminToken: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const masterKeyHex = env.MCP_GATEWAY_MASTER_KEY;
  if (!masterKeyHex) {
    throw new Error(
      'MCP_GATEWAY_MASTER_KEY is required (32-byte hex). Generate one with:\n' +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  const masterKey = Buffer.from(masterKeyHex, 'hex');
  if (masterKey.length !== 32) {
    throw new Error('MCP_GATEWAY_MASTER_KEY must be 64 hex characters (32 bytes)');
  }

  const adminToken = env.MCP_GATEWAY_ADMIN_TOKEN;
  if (!adminToken) {
    throw new Error(
      'MCP_GATEWAY_ADMIN_TOKEN is required. Generate one with:\n' +
        `  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`,
    );
  }

  return {
    port: Number(env.MCP_GATEWAY_PORT ?? 8787),
    dbPath: env.MCP_GATEWAY_DB_PATH ?? 'data/gateway.db',
    masterKey,
    adminToken,
  };
}

export function generateApiKey(): string {
  return `mcpgw_${randomBytes(24).toString('base64url')}`;
}
