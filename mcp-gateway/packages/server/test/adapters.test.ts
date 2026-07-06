import { describe, expect, it } from 'vitest';
import { getAdapter, listAdapters } from '../src/adapters/registry.js';

describe('adapter registry', () => {
  it('registers asana, atlassian, box, and generic', () => {
    expect(listAdapters().map((a) => a.type).sort()).toEqual(['asana', 'atlassian', 'box', 'generic']);
  });

  it('throws on unknown adapter types', () => {
    expect(() => getAdapter('salesforce')).toThrow(/Unknown adapter/);
  });
});

describe('atlassian adapter', () => {
  const adapter = getAdapter('atlassian');
  const ALLOWED = 'cloud-1111';

  it('uses the hosted Rovo MCP endpoint by default', () => {
    expect(adapter.defaultUpstreamUrl).toBe('https://mcp.atlassian.com/v1/mcp');
  });

  it('sends the endpoint token as a bearer header', () => {
    expect(adapter.buildAuthHeaders({ token: 'tok' })).toEqual({ Authorization: 'Bearer tok' });
  });

  it('allows calls targeting the allowed cloudId', () => {
    const result = adapter.enforceTenant('search', { cloudId: ALLOWED, query: 'x' }, ALLOWED);
    expect(result).toEqual({ ok: true, args: { cloudId: ALLOWED, query: 'x' } });
  });

  it('rejects calls targeting another cloudId', () => {
    const result = adapter.enforceTenant('search', { cloudId: 'cloud-9999' }, ALLOWED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('cloud-9999');
  });

  it('rejects cloudIds hidden in nested arguments (snake_case variant)', () => {
    const result = adapter.enforceTenant('createIssue', { fields: { cloud_id: 'cloud-9999' } }, ALLOWED);
    expect(result.ok).toBe(false);
  });

  it('injects the allowed cloudId when the tool accepts it and the caller omits it', () => {
    const schema = { type: 'object', properties: { cloudId: { type: 'string' }, query: {} } };
    const result = adapter.enforceTenant('search', { query: 'x' }, ALLOWED, schema);
    expect(result).toEqual({ ok: true, args: { query: 'x', cloudId: ALLOWED } });
  });

  it('does not inject when the tool has no cloudId parameter', () => {
    const schema = { type: 'object', properties: { query: {} } };
    const result = adapter.enforceTenant('whoami', { query: 'x' }, ALLOWED, schema);
    expect(result).toEqual({ ok: true, args: { query: 'x' } });
  });
});

describe('box adapter', () => {
  const adapter = getAdapter('box');
  const ALLOWED = 'ent-1111';

  it('uses the hosted Box MCP endpoint by default', () => {
    expect(adapter.defaultUpstreamUrl).toBe('https://mcp.box.com');
  });

  it('passes through tools without tenant arguments (token is the boundary)', () => {
    const result = adapter.enforceTenant('search_files', { query: 'contract' }, ALLOWED);
    expect(result).toEqual({ ok: true, args: { query: 'contract' } });
  });

  it('rejects enterprise_id arguments for another enterprise', () => {
    const result = adapter.enforceTenant('admin_search', { enterprise_id: 'ent-9999' }, ALLOWED);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('ent-9999');
  });
});
