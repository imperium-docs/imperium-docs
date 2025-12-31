# Atlas Pipeline

Pipeline unico em Python com juiz deterministico + memoria. Gera `atlas-site/feed.json` e `atlas-site/state.json`
e sincroniza `atlas-site/content/atlas/`.

## Politica editorial
- Apenas fontes oficiais, institucionais e jornalismo financeiro profissional.
- PR wires, agregadores genericos, blogs e fontes promocionais sao proibidos.
- Descoberta RSS-only (feeds oficiais ou sitemaps institucionais).
- Zero noticias em um ciclo e aceitavel quando nao ha evidencias.

## Rodar localmente
```bash
python -m pip install -r requirements.txt
python src/main.py
```

## Workflow
O workflow `Atlas Cron` executa:
1) testes (`pytest`)
2) pipeline (`python src/main.py`)
3) autopublish (Node)
4) commit/push se houver mudancas
