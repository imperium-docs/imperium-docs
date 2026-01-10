# Imperium Atlas (Python Judge Core)

Pipeline unico (Python) com juiz deterministico + extracao por URL para gerar `feed.json` e `state.json`.

## Politica editorial (whitelist canonica)
- Apenas fontes oficiais, institucionais e jornalismo financeiro profissional.
- PR wires, agregadores genericos, blogs e fontes promocionais sao proibidos.
- Descoberta multi-metodo (rss, sitemap, html).
- Zero noticias em um ciclo e aceitavel se nao houver evidencias suficientes.

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

## Autopublish (Node)
`npm run autopublish:ci` valida o feed v4 e gera cards em `content/atlas/records/` a partir do feed canonico.

## Saidas
- `feed.json` (v4 canonico)
- `state.json` (v4 canonico)

## Fontes RSS
Edite `sources.whitelist.json` para controlar os metodos e fontes permitidas.

Schema recomendado por source: `name`, `domain`, `method` (rss|sitemap|html), `url`/`feed_url`, `selectors` (html),
`priority`, `is_primary`, `category_hints`.
