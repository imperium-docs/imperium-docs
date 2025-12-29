# Imperium Atlas (RSS Cron)

Pipeline RSS-only para gerar `feed.json` e `state.json` (v3) para o renderer.

## Politica de LLM (OpenRouter somente)
- Provider fixo: OpenRouter.
- Modelo fixo: `meta-llama/llama-3.2-3b-instruct:free`.
- Modelos pagos ou diferentes sao bloqueados.
- LLM so roda se `ATLAS_LLM_ENABLED="true"`.

## Cron oficial
O workflow `Atlas Cron` roda 3 vezes ao dia (UTC) e publica atualizacoes.

## Variaveis de ambiente
Somente estas variaveis sao usadas:
- `OPENROUTER_API_KEY`
- `ATLAS_LLM_ENABLED`
- `ATLAS_LLM_PROVIDER`

## Rodar localmente
```bash
npm install
npm run atlas:cron
```

## Saidas
- `content/atlas/feed.json` (v3)
- `content/atlas/state.json` (v3)

## Fontes RSS
Edite `sources.whitelist.json` para controlar os feeds permitidos.
