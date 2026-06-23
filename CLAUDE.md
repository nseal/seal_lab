# seal_lab

## Daily Claude Article Search

This repo collects daily digests of top Claude / Anthropic articles.

### Run manually

```
/daily-claude-article-search
```

Searches the web for today's Claude-related articles and saves a Markdown digest to `article/YYYY-MM-DD.md`.

### Automation

A GitHub Actions workflow (`.github/workflows/daily-article-search.yml`) runs the skill every day at **08:00 UTC**.

**Required secret**: `ANTHROPIC_API_KEY` — add it under *Settings → Secrets and variables → Actions*.

### Article folder

All digests live in `article/` and are named by date: `article/2026-06-23.md`.
