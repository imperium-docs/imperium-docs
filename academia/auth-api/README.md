# Academia Auth API

Backend de OAuth para Academia. Suporta Apple, Google, GitHub e Meta.

## Requisitos
- Node.js 20.19+ ou 22.12+

## Setup rapido
1) Crie `.env` baseado em `.env.example`.
2) Instale dependencias: `npm install`
3) Inicie o servidor: `npm run dev`

Por padrao, o servidor sobe em `http://localhost:8787`.

## Variaveis de ambiente
- `PUBLIC_BASE_URL` base publica para callbacks. Ex: `http://localhost:8787`
- `FRONTEND_BASE_URL` url do frontend Vite. Ex: `http://localhost:5173`
- `ALLOWED_ORIGINS` lista separada por virgula.
- `DATABASE_PATH` caminho do SQLite.
- `COOKIE_SECRET` segredo para cookies.
- `COOKIE_SECURE` use `true` em producao (https).

### Apple
- `APPLE_CLIENT_ID` (Service ID)
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_PRIVATE_KEY` (conteudo, use `\n` para quebras)
- ou `APPLE_PRIVATE_KEY_FILE` (arquivo .p8)

### Google, GitHub, Meta
Preencha `*_CLIENT_ID`, `*_CLIENT_SECRET` e opcionalmente `*_REDIRECT_URI`.

## Endpoints
- `GET /auth/:provider`
- `GET|POST /auth/:provider/callback`
- `POST /auth/collect-email`
- `POST /analytics/event`
- `GET /analytics/providers`

## Tests
`npm test`
