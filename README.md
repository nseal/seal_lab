# seal_lab

実験・ツール置き場。

> **移設のお知らせ**: MCP Gateway(テナント制限つき MCP 中間プロキシ)は専用リポジトリ [nseal/mcp-gateway](https://github.com/nseal/mcp-gateway) に移動しました。

## Daily Claude Article Search

Claude / Anthropic 関連の注目記事を毎日収集し、[`article/`](article/) に日付つき Markdown ダイジェスト (`article/YYYY-MM-DD.md`) として保存します。

- GitHub Actions ([.github/workflows/daily-article-search.yml](.github/workflows/daily-article-search.yml)) が毎日 **08:00 UTC** に自動実行
- 手動実行は Claude Code で `/daily-claude-article-search`
- 必要なシークレット: `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions)

## リポジトリ構成

```
article/           日次記事ダイジェスト
.github/           記事収集の GitHub Actions ワークフロー
CLAUDE.md          Claude Code 向けのプロジェクト説明
```
