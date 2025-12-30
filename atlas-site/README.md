# Imperium Atlas (Python Judge + Memory)

Pipeline unico (Python) com juiz deterministico + memoria para gerar `feed.json` e `state.json`.

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
python -m pip install -r ../atlas-pipeline/requirements.txt
python ../atlas-pipeline/src/main.py
```

## Saidas
- `feed.json` (v4)
- `state.json` (v4)
- `content/atlas/feed.json` (v4)
- `content/atlas/state.json` (v4)

## Fontes RSS
Edite `sources.whitelist.json` para controlar os feeds permitidos.
