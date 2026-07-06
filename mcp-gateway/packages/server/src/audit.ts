import { createHash } from 'node:crypto';
import type { AuditDecision, Repo } from './db/repo.js';

/**
 * Records tool-call outcomes. Only a digest of the arguments is stored so the
 * audit trail itself cannot leak tenant data.
 */
export function recordToolCall(
  repo: Repo,
  input: {
    endpointId: string;
    toolName: string;
    decision: AuditDecision;
    detail?: string;
    args?: Record<string, unknown>;
  },
): void {
  const argsDigest = input.args
    ? createHash('sha256').update(JSON.stringify(input.args)).digest('hex').slice(0, 16)
    : '';
  try {
    repo.addAuditLog({
      endpointId: input.endpointId,
      toolName: input.toolName,
      decision: input.decision,
      detail: input.detail,
      argsDigest,
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
