# seal_lab

実験・ツール置き場。現在は以下の2つが入っています。

## 1. MCP Gateway — テナント制限つき MCP 中間プロキシ

[`mcp-gateway/`](mcp-gateway/) — クライアントと上流 MCP サーバー(Asana / Atlassian / Box など)の間に立つプロキシ。既存の MCP サーバーでは制限できない「接続先テナント」を接続口ごとに固定し、情報漏洩を防ぎます。

- 接続口(エンドポイント)ごとに **専用の上流認証情報・許可テナントID・公開ツール allowlist・APIキー** を Web 管理画面から個別管理
- 全ツール呼び出しの許可/拒否を記録する監査ログ
- Azure Container Apps へのデプロイ手順書つき ([mcp-gateway/docs/deploy-azure.md](mcp-gateway/docs/deploy-azure.md))

```bash
cd mcp-gateway
npm install
npm test        # e2e テスト
npm run dev     # http://localhost:8787 (管理画面は /admin/)
```

詳細は [mcp-gateway/README.md](mcp-gateway/README.md) を参照。

## 2. Daily Claude Article Search

Claude / Anthropic 関連の注目記事を毎日収集し、[`article/`](article/) に日付つき Markdown ダイジェスト (`article/YYYY-MM-DD.md`) として保存します。

- GitHub Actions ([.github/workflows/daily-article-search.yml](.github/workflows/daily-article-search.yml)) が毎日 **08:00 UTC** に自動実行
- 手動実行は Claude Code で `/daily-claude-article-search`
- 必要なシークレット: `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions)

## リポジトリ構成

```
mcp-gateway/       MCP Gateway (TypeScript monorepo: server + admin-ui)
article/           日次記事ダイジェスト
.github/           記事収集の GitHub Actions ワークフロー
CLAUDE.md          Claude Code 向けのプロジェクト説明
```
