import type { UpstreamAdapter } from './types.js';
import { asanaAdapter } from './asana.js';
import { genericAdapter } from './generic.js';

const adapters = new Map<string, UpstreamAdapter>(
  [asanaAdapter, genericAdapter].map((a) => [a.type, a]),
);

export function getAdapter(type: string): UpstreamAdapter {
  const adapter = adapters.get(type);
  if (!adapter) {
    throw new Error(`Unknown adapter type: ${type}`);
  }
  return adapter;
}

export function listAdapters(): UpstreamAdapter[] {
  return [...adapters.values()];
}
