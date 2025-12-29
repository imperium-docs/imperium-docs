# Atlas Site

This repo runs the Atlas RSS pipeline and publishes `data/feed.json` and `data/state.json` (v3) for the renderer.

## LLM policy (OpenRouter only)
- Provider is fixed to OpenRouter.
- Model is fixed to `meta-llama/llama-3.2-3b-instruct:free`.
- Paid or non-free models are blocked.
- LLM is gated by `ATLAS_LLM_ENABLED`.

## Cron workflow
The GitHub Actions workflow runs on a schedule and commits updated feed/state files.

## Environment variables
Only the following variables are used:
- `OPENROUTER_API_KEY`
- `ATLAS_LLM_ENABLED` (set to "true" to enable)
- `ATLAS_LLM_PROVIDER` (must be "openrouter")

## Run locally
```bash
npm install
npm run atlas:cron
```
