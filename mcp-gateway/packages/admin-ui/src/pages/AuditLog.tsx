import { useEffect, useState } from 'react';
import { api, type AuditLog, type Endpoint } from '../api';
import type { Route } from '../App';

const decisionLabels: Record<AuditLog['decision'], { text: string; cls: string }> = {
  allowed: { text: '許可', cls: 'ok' },
  denied_tool: { text: 'ツール拒否', cls: 'deny' },
  denied_tenant: { text: 'テナント拒否', cls: 'deny' },
  error: { text: '上流エラー', cls: 'off' },
};

export function AuditLogPage({
  navigate,
  endpointId,
}: {
  navigate: (r: Route) => void;
  endpointId: string;
}) {
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getEndpoint(endpointId).then(setEndpoint).catch((err) => setError(String(err)));
    api.listAuditLogs(endpointId).then(setLogs).catch((err) => setError(String(err)));
  }, [endpointId]);

  return (
    <>
      <div className="topbar">
        <h2>監査ログ{endpoint ? `: ${endpoint.name}` : ''}</h2>
        <button onClick={() => navigate({ page: 'list' })}>一覧に戻る</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card">
        {logs.length === 0 ? (
          <p>まだツール呼び出しの記録がありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日時 (UTC)</th>
                <th>ツール</th>
                <th>判定</th>
                <th>詳細</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const d = decisionLabels[l.decision] ?? { text: l.decision, cls: 'off' };
                return (
                  <tr key={l.id}>
                    <td>{l.createdAt}</td>
                    <td>
                      <code>{l.toolName}</code>
                    </td>
                    <td>
                      <span className={`pill ${d.cls}`}>{d.text}</span>
                    </td>
                    <td>{l.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
