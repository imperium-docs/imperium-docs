# Atlas Pipeline

Pipeline unico em Python (Judge Core) com descoberta multi-metodo, extracao de URL e evidencias reais.
Gera `atlas-site/feed.json` (v4) e `atlas-site/state.json` (v4) como fontes canonicas.

## Politica editorial
- Apenas fontes oficiais, institucionais e jornalismo financeiro profissional.
- PR wires, agregadores genericos, blogs e fontes promocionais sao proibidos.
- Descoberta multi-metodo: rss, sitemap e html (press releases / newsrooms).
- Zero noticias em um ciclo e aceitavel quando nao ha evidencias suficientes.

## Rodar localmente
```bash
python -m pip install -r requirements.txt
python src/main.py
```

## Workflow
O workflow `Atlas Cron` executa:
1) testes (`pytest`)
2) pipeline (`python src/main.py`)
3) autopublish (Node, consumer/validator)
4) commit/push se houver mudancas
