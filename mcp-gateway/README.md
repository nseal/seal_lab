# MCP Gateway — テナント制限つき MCP 中間管理システム

既存の MCP サーバー(例: Asana 公式 MCP)は接続先テナントを制限できず、認証情報をクライアントに直接渡すと、そのユーザーが見える全テナントの情報に到達できてしまいます。

MCP Gateway はクライアントと上流 MCP サーバーの間に立つプロキシです。管理者が「接続口(エンドポイント)」を作成し、接続口ごとに以下を個別管理します:

- **専用の上流認証情報** — クライアントは上流のトークンを一切見ない
- **許可テナント ID** — 他テナントを指すツール引数は遮断(引数省略時は許可テナントを自動注入)
- **公開ツールの allowlist** — 未選択のツールは一覧にも出ず、呼び出しも拒否
- **接続口ごとの API キー** — 発行・失効を管理画面から操作
- **監査ログ** — 全ツール呼び出しの許可/拒否を記録

```
クライアント (Claude 等)                     MCP Gateway                          上流 MCP サーバー
  │  /mcp/asana-team-a + APIキー ─────▶  allowlist / テナント検証  ──専用トークン──▶  Asana (workspace A)
  │  /mcp/asana-team-b + APIキー ─────▶  allowlist / テナント検証  ──専用トークン──▶  Asana (workspace B)
```

## セットアップ

```bash
cd mcp-gateway
npm install
npm run build

# シークレットを生成
export MCP_GATEWAY_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
export MCP_GATEWAY_ADMIN_TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")

node packages/server/dist/index.js
# MCP endpoints: http://localhost:8787/mcp/<slug>
# Admin UI:      http://localhost:8787/admin/
```

### 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `MCP_GATEWAY_MASTER_KEY` | ✔ | 上流認証情報の暗号化キー (32バイト hex)。紛失すると保存済みトークンを復号できません |
| `MCP_GATEWAY_ADMIN_TOKEN` | ✔ | 管理 API / 管理画面のログイントークン |
| `MCP_GATEWAY_PORT` | | 待受ポート (デフォルト 8787) |
| `MCP_GATEWAY_DB_PATH` | | SQLite ファイルパス (デフォルト `data/gateway.db`) |

## 使い方

1. `http://localhost:8787/admin/` を開き、管理トークンでログイン
2. 「接続口を作成」— アダプタ (Asana / Generic)、上流トークン、**許可テナント ID**(Asana はワークスペース GID)を入力
3. 「上流からツールを取得」で公開するツールをチェックボックスで選択
4. API キーを発行(平文は発行時に一度だけ表示)
5. クライアントを接続:

```bash
claude mcp add asana-team-a --transport http http://localhost:8787/mcp/asana-team-a \
  --header "Authorization: Bearer mcpgw_..."
```

## テナント制限のしくみ(二重防御)

1. **構造的防御(主)**: 接続口ごとに専用の上流トークンを暗号化保存。トークン自体が単一テナントに限定されていれば、他テナントには構造上到達できません。
2. **検証的防御(副)**: アダプタが宣言するテナント引数(Asana: `workspace`, `workspace_gid`, `workspace_id`)を `tools/call` の引数からネスト構造ごと検査。許可テナントと不一致なら拒否し、監査ログに `denied_tenant` として記録します。ツールが引数を受け付けるのに省略された場合は許可テナント ID を強制注入します。

## 開発

```bash
npm test                                    # e2e テスト (mock 上流に対して 15 ケース)
npm run typecheck                           # 型チェック
npm run dev                                 # サーバーを tsx で起動
npm run mock-upstream -w @mcp-gateway/server  # テスト用の偽上流 MCP サーバー (port 9797)
npm run dev -w @mcp-gateway/admin-ui        # 管理画面の Vite dev server (API は 8787 にプロキシ)
```

Asana の実トークンなしで動作確認する場合は、mock 上流 (`http://localhost:9797/mcp`) を上流 URL に指定してください。`list_tasks` / `create_task` / `delete_everything` の 3 ツールを持ち、`workspace` 引数がテナントに相当します。

## アーキテクチャ

```
packages/server/src/
├── index.ts            エントリポイント
├── app.ts              Express アプリ組み立て (MCP・管理API・管理画面配信)
├── config.ts           環境変数
├── crypto.ts           AES-256-GCM 暗号化・APIキーのハッシュ化
├── audit.ts            監査ログ記録 (引数はダイジェストのみ保存)
├── db/                 SQLite (endpoints / api_keys / audit_logs)
├── adapters/           上流サービスごとの定義 (asana / generic)
│                       └ 認証ヘッダ生成・テナント引数の宣言と検査
├── proxy/
│   ├── upstream.ts     上流 MCP クライアントのプール (接続口ごと・専用トークン)
│   ├── policy.ts       allowlist 判定 + テナント検証
│   └── mcp-server.ts   セッションごとの MCP サーバー (毎リクエストで最新設定を反映)
└── routes/
    ├── mcp.ts          /mcp/:slug (Streamable HTTP, APIキー認証)
    └── admin.ts        /api/admin/* (接続口 CRUD・ツール発見・キー発行・監査ログ)
packages/admin-ui/      React + Vite の管理画面 (/admin で配信)
```

新しい上流サービスへの対応は `adapters/` に `UpstreamAdapter` 実装を1ファイル追加して `registry.ts` に登録するだけです。

## 将来拡張(未実装)

- Asana OAuth 認可コードフローによるトークン取得(現状は管理者がトークンを貼り付け)
- resources / prompts のプロキシ(現状は tools のみ)
- 管理者のマルチユーザー / RBAC(現状は単一の管理トークン)
