import { useState } from 'react';
import { clearToken, getToken, setToken } from './api';
import { EndpointList } from './pages/EndpointList';
import { EndpointEdit } from './pages/EndpointEdit';
import { AuditLogPage } from './pages/AuditLog';

export type Route =
  | { page: 'list' }
  | { page: 'new' }
  | { page: 'edit'; endpointId: string }
  | { page: 'audit'; endpointId: string };

export function App() {
  const [route, setRoute] = useState<Route>({ page: 'list' });
  const [authed, setAuthed] = useState(() => getToken() !== '');

  if (!authed) {
    return <TokenGate onSubmit={() => setAuthed(true)} />;
  }

  return (
    <main>
      <div className="topbar">
        <h1>
          <a onClick={() => setRoute({ page: 'list' })}>MCP Gateway 管理画面</a>
        </h1>
        <button
          onClick={() => {
            clearToken();
            setAuthed(false);
          }}
        >
          ログアウト
        </button>
      </div>
      {route.page === 'list' && <EndpointList navigate={setRoute} />}
      {route.page === 'new' && <EndpointEdit navigate={setRoute} />}
      {route.page === 'edit' && <EndpointEdit navigate={setRoute} endpointId={route.endpointId} />}
      {route.page === 'audit' && <AuditLogPage navigate={setRoute} endpointId={route.endpointId} />}
    </main>
  );
}

function TokenGate({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('');
  return (
    <main>
      <h1>MCP Gateway 管理画面</h1>
      <div className="card">
        <label>
          管理トークン (MCP_GATEWAY_ADMIN_TOKEN)
          <div className="hint">サーバー起動時に設定した管理トークンを入力してください。</div>
        </label>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value) {
              setToken(value);
              onSubmit();
            }
          }}
        />
        <div style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={!value}
            onClick={() => {
              setToken(value);
              onSubmit();
            }}
          >
            ログイン
          </button>
        </div>
      </div>
    </main>
  );
}
