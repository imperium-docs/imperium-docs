# Scrinium (Netflix-like)

## Visao geral
Scrinium roda em HTML/CSS/JS puro com Video.js carregado sob demanda. Os rails e cards sao gerados a partir de `scrinium-data.json`, com preview no hover (desktop) e player em modal.

## Estrutura principal
- `index.html`: pagina Scrinium.
- `scrinium-data.json`: dados normalizados (itens + rails).
- `scrinium.js`: preview manager, modal player, progresso e telemetria.
- `scrinium.css`: tema visual + overrides do Video.js.
- `assets/vendor/`: Video.js e CSS.
- `assets/vtt/`: legendas/chapters de exemplo.

## Schema de item (scrinium-data.json)
Cada item segue o formato abaixo:
```json
{
  "id": "string",
  "type": "series | course | documentary",
  "title": "string",
  "subtitle": "string",
  "synopsis": "string",
  "year": 2025,
  "maturityRating": "14",
  "durationSec": 1800,
  "seasons": [
    {
      "seasonNumber": 1,
      "episodes": [
        {
          "episodeNumber": 1,
          "title": "string",
          "durationSec": 1200,
          "sources": { "hls": "url", "dash": "url", "mp4Fallback": "url" },
          "thumbnailsVtt": "url",
          "captions": [{ "src": "url", "srclang": "pt-BR", "label": "Portugues", "default": true }],
          "chaptersVtt": "url"
        }
      ]
    }
  ],
  "sources": { "hls": "url", "dash": "url", "mp4Fallback": "url" },
  "poster": "url",
  "cardImage": "url",
  "logoImage": "url",
  "preview": { "startSec": 6, "endSec": 14 },
  "captions": [{ "src": "url", "srclang": "pt-BR", "label": "Portugues" }],
  "chaptersVtt": "url",
  "thumbnailsVtt": "url",
  "tags": ["string"],
  "featured": true,
  "order": 1,
  "progress": { "lastTimeSec": 120, "completed": false }
}
```

## Como adicionar um item
1) Adicione o item em `scrinium-data.json` com `id` unico.
2) Inclua o `id` em algum rail dentro de `rails`.
3) Aponte `sources` para `hls` (preferencial) e `mp4Fallback`.
4) Defina `cardImage` (16:9) e `poster` (hero/vertical).
5) Se houver, adicione `captions`, `chaptersVtt` e `thumbnailsVtt`.

## Preview + Modal
- Preview no hover (desktop) monta Video.js apenas no card ativo e descarta no mouseout.
- Modal abre no clique, carrega Video.js completo, tracks de legenda e chapters.
- Progresso e "Retomar" sao salvos em localStorage:
  - `imperium:scrinium:progress:{contentId}:{episodeId?}`

## Observacoes
- Os exemplos usam streams publicas de teste. Troque por suas URLs reais.
- Sem framework extra: tudo roda no client.
