import { loadConfig } from './config.js';
import { createGateway } from './app.js';

const config = loadConfig();
const gateway = createGateway(config);

const server = gateway.app.listen(config.port, () => {
  console.log(`MCP gateway listening on http://localhost:${config.port}`);
  console.log(`  MCP endpoints: http://localhost:${config.port}/mcp/<slug>`);
  console.log(`  Admin UI:      http://localhost:${config.port}/admin/`);
});

async function shutdown() {
  server.close();
  await gateway.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
