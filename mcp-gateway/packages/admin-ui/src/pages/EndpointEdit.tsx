import { useEffect, useState } from 'react';
import { api, type AdapterInfo, type ApiKeyInfo, type DiscoveredTool } from '../api';
import type { Route } from '../App';

interface Props {
  navigate: (r: Route) => void;
  endpointId?: string;
}

function tenantHint(adapterType: string): string {
  switch (adapterType) {
    case 'asana':
      return 'Asana のワークスペース GID。このワークスペース以外へのアクセスは遮断されます。';
    case 'atlassian':
      return (
        'Atlassian サイトの cloudId。https://<サイト名>.atlassian.net/_edge/tenant_info で確認できます。' +
        'この cloudId 以外へのアクセスは遮断されます。'
      );
    case 'box':
      return (
        'Box のエンタープライズ ID (管理コンソール → アカウント情報)。Box はトークン自体がテナントに紐づくため、' +
        'この接続口専用のトークンを使うことが主な防御になります。'
      );
    default:
      return 'このテナント以外を指すツール引数は遮断されます。';
  }
}

export function EndpointEdit({ navigate, endpointId }: Props) {
  const isNew = !endpointId;
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [adapterType, setAdapterType] = useState('asana');
  const [upstreamUrl, setUpstreamUrl] = useState('');
  const [token, setTokenValue] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredTool[] | null>(null);
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    api.listAdapters().then(setAdapters).catch((err) => setError(String(err)));
    if (endpointId) {
      api
        .getEndpoint(endpointId)
        .then((e) => {
          setSlug(e.slug);
          setName(e.name);
          setAdapterType(e.adapterType);
          setUpstreamUrl(e.upstreamUrl);
          setTenantId(e.allowedTenantId);
          setEnabled(e.enabled);
          setAllowedTools(e.allowedTools);
        })
        .catch((err) => setError(String(err)));
    }
  }, [endpointId]);

  const adapter = adapters.find((a) => a.type === adapterType);

  async function save(): Promise<string | undefined> {
    setError('');
    setNotice('');
    setSaving(true);
    try {
      if (isNew) {
        const created = await api.createEndpoint({
          slug,
          name,
          adapterType,
          upstreamUrl: upstreamUrl || undefined,
          credentials: { token },
          allowedTenantId: tenantId,
          allowedTools,
          enabled,
        });
        setNotice('作成しました。続けて「ツールを取得」で公開ツールを選択し、APIキーを発行してください。');
        navigate({ page: 'edit', endpointId: created.id });
        return created.id;
      }
      await api.updateEndpoint(endpointId!, {
        name,
        upstreamUrl: upstreamUrl || undefined,
        ...(token ? { credentials: { token } } : {}),
        allowedTenantId: tenantId,
        allowedTools,
        enabled,
      });
      setNotice('保存しました。');
      setTokenValue('');
      return endpointId;
    } catch (err) {
      setError(String(err));
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  async function discoverTools() {
    setError('');
    setDiscovering(true);
    try {
      // Discovery needs saved credentials, so persist the form first.
      const id = await save();
      if (!id) return;
      const tools = await api.discoverTools(id);
      setDiscovered(tools);
    } catch (err) {
      setError(String(err));
    } finally {
      setDiscovering(false);
    }
  }

  function toggleTool(toolName: string) {
    setAllowedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName],
    );
  }

  return (
    <>
      <h2>{isNew ? '接続口を作成' : `接続口を編集: ${name}`}</h2>
      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      <div className="card">
        <label>
          スラッグ (URLの一部: /mcp/&lt;slug&gt;)
          <div className="hint">小文字英数字とハイフン。作成後は変更できません。例: asana-team-a</div>
        </label>
        <input type="text" value={slug} disabled={!isNew} onChange={(e) => setSlug(e.target.value)} />

        <label>表示名</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />

        <label>アダプタ (接続先サービス)</label>
        <select value={adapterType} disabled={!isNew} onChange={(e) => setAdapterType(e.target.value)}>
          {adapters.map((a) => (
            <option key={a.type} value={a.type}>
              {a.displayName}
            </option>
          ))}
        </select>

        <label>
          上流 MCP サーバー URL
          {adapter?.defaultUpstreamUrl && (
            <div className="hint">空欄の場合は {adapter.defaultUpstreamUrl} を使用します。</div>
          )}
        </label>
        <input
          type="url"
          value={upstreamUrl}
          placeholder={adapter?.defaultUpstreamUrl ?? ''}
          onChange={(e) => setUpstreamUrl(e.target.value)}
        />

        <label>
          上流アクセストークン
          <div className="hint">
            この接続口専用のトークン。許可テナントのみにアクセスできるトークンを使用してください。
            {!isNew && ' 空欄のままにすると現在のトークンを維持します。'}
          </div>
        </label>
        <input type="password" value={token} onChange={(e) => setTokenValue(e.target.value)} />

        <label>
          許可テナント ID
          <div className="hint">
            {tenantHint(adapterType)}
            {adapter && ` 検査対象の引数: ${adapter.tenantParamNames.join(', ')}`}
          </div>
        </label>
        <input type="text" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          有効 (オフにすると全クライアントの接続を遮断)
        </label>
      </div>

      <div className="card">
        <div className="topbar">
          <strong>公開ツール ({allowedTools.length} 件選択中)</strong>
          <button onClick={discoverTools} disabled={discovering || (isNew && (!slug || !name || !token || !tenantId))}>
            {discovering ? '取得中…' : '上流からツールを取得'}
          </button>
        </div>
        <div className="hint">
          選択したツールだけがクライアントに公開されます。未選択のツールは一覧にも表示されず、呼び出しも拒否されます。
        </div>
        {discovered ? (
          <div className="tool-grid">
            {discovered.map((t) => (
              <label key={t.name} title={t.description}>
                <input
                  type="checkbox"
                  checked={allowedTools.includes(t.name)}
                  onChange={() => toggleTool(t.name)}
                />
                <span>
                  <code>{t.name}</code>
                  {t.description && <div className="hint">{t.description}</div>}
                </span>
              </label>
            ))}
          </div>
        ) : allowedTools.length > 0 ? (
          <p>
            現在の許可リスト: <code>{allowedTools.join(', ')}</code>
          </p>
        ) : (
          <p className="hint">「上流からツールを取得」を押すと選択肢が表示されます。</p>
        )}
      </div>

      <div style={{ margin: '16px 0' }}>
        <button className="primary" onClick={save} disabled={saving || !slug || !name || !tenantId || (isNew && !token)}>
          {saving ? '保存中…' : isNew ? '作成' : '保存'}
        </button>
        <button onClick={() => navigate({ page: 'list' })}>一覧に戻る</button>
        {!isNew && (
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`接続口 "${name}" を削除しますか? APIキーも全て無効になります。`)) return;
              await api.deleteEndpoint(endpointId!);
              navigate({ page: 'list' });
            }}
          >
            削除
          </button>
        )}
      </div>

      {!isNew && <ApiKeySection endpointId={endpointId!} slug={slug} />}
    </>
  );
}

function ApiKeySection({ endpointId, slug }: { endpointId: string; slug: string }) {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [label, setLabel] = useState('');
  const [issued, setIssued] = useState<{ key: string; label: string } | null>(null);
  const [error, setError] = useState('');

  const reload = () => api.listApiKeys(endpointId).then(setKeys).catch((err) => setError(String(err)));
  useEffect(() => {
    void reload();
  }, [endpointId]);

  return (
    <div className="card">
      <strong>APIキー</strong>
      <div className="hint">
        クライアントはこのキーで <code>/mcp/{slug}</code> に接続します (Authorization: Bearer)。
      </div>
      {error && <p className="error">{error}</p>}
      {issued && (
        <div>
          <p className="success">
            キー「{issued.label || '(ラベルなし)'}」を発行しました。この値は今しか表示されません:
          </p>
          <code className="block">{issued.key}</code>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <input
          type="text"
          placeholder="ラベル (例: marketing-bot)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          className="primary"
          onClick={async () => {
            try {
              const res = await api.issueApiKey(endpointId, label);
              setIssued({ key: res.key, label: res.label });
              setLabel('');
              await reload();
            } catch (err) {
              setError(String(err));
            }
          }}
        >
          発行
        </button>
      </div>
      {keys.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>ラベル</th>
              <th>作成日時</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.label || '(ラベルなし)'}</td>
                <td>{k.createdAt}</td>
                <td>
                  <span className={`pill ${k.revokedAt ? 'deny' : 'ok'}`}>
                    {k.revokedAt ? '失効済み' : '有効'}
                  </span>
                </td>
                <td>
                  {!k.revokedAt && (
                    <button
                      className="danger"
                      onClick={async () => {
                        if (!confirm('このAPIキーを失効させますか?')) return;
                        await api.revokeApiKey(endpointId, k.id);
                        await reload();
                      }}
                    >
                      失効
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
