import { useEffect, useState } from 'react';
import { api, ApiError, clearToken, type Endpoint } from '../api';
import type { Route } from '../App';

export function EndpointList({ navigate }: { navigate: (r: Route) => void }) {
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .listEndpoints()
      .then(setEndpoints)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          location.reload();
          return;
        }
        setError(String(err));
      });
  }, []);

  return (
    <>
      <div className="topbar">
        <h2>接続口一覧</h2>
        <button className="primary" onClick={() => navigate({ page: 'new' })}>
          + 接続口を作成
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card">
        {endpoints === null ? (
          <p>読み込み中…</p>
        ) : endpoints.length === 0 ? (
          <p>
            接続口がまだありません。「接続口を作成」から、接続先テナントと公開ツールを制限した
            MCP エンドポイントを作成してください。
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>アダプタ</th>
                <th>許可テナント</th>
                <th>公開ツール数</th>
                <th>状態</th>
                <th>MCP URL</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.id}>
                  <td>
                    <a onClick={() => navigate({ page: 'edit', endpointId: e.id })}>{e.name}</a>
                  </td>
                  <td>{e.adapterType}</td>
                  <td>{e.allowedTenantId}</td>
                  <td>{e.allowedTools.length}</td>
                  <td>
                    <span className={`pill ${e.enabled ? 'ok' : 'off'}`}>
                      {e.enabled ? '有効' : '無効'}
                    </span>
                  </td>
                  <td>
                    <code>/mcp/{e.slug}</code>
                  </td>
                  <td>
                    <a onClick={() => navigate({ page: 'audit', endpointId: e.id })}>監査ログ</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
