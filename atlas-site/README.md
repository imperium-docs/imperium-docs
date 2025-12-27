# Imperium Atlas Ingest

Pipeline automatizado para gerar:
- Um artigo editorial em MDX
- Um JSON de evento
- Um JSON com 3 graficos

## Requisitos
- Node.js 18+ (fetch nativo)
- `OPENAI_API_KEY` no ambiente (use `.env`)

## Instalar dependencias
```bash
npm install
```

## Rodar ingest manual
```bash
npm run ingest -- --category billionaire
npm run ingest -- --category ipo
npm run ingest -- --category revenue
```

## Saidas geradas
- `content/news/<slug>.mdx` (quando status = verified)
- `drafts/<slug>.mdx` (quando status = needs_review)
- `data/events/<slug>.json`
- `data/charts/<slug>.json`
- `logs/ingest-YYYY-MM-DD.log`
- `logs/_last_run.json` (quando status = needs_review)

## Whitelist de fontes
Edite `data/sources/whitelist.json` para controlar os dominios permitidos.
- Use dominios raiz (ex: `sec.gov`, `reuters.com`)
- Cada entrada possui `domain`, `kind`, `weight` e `tags`
- A politica define `sources_per_article` e pesos minimos

## Como adicionar fontes
1. Adicione o dominio em `data/sources/whitelist.json`
2. Rode o ingest novamente

## Regras de publicacao
- Deve existir pelo menos 1 fonte primaria
- Sem fonte primaria, status = needs_review e o MDX vai para `drafts/`
- Cada numero relevante exige quote curta (<= 25 palavras) e URL

## Variaveis de ambiente
Crie um `.env` em `atlas-site/`:
```
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1
```
