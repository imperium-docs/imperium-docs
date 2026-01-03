# Ordem

Ordem is the Imperium direct message workspace that runs as a Telegram Mini App (Mode B). It uses Telegram for identity, a sovereign API for data, and a Telegram-like UI for conversations.

## Stack

- Web: Next.js (App Router)
- API: Fastify
- DB: SQLite via Drizzle ORM
- Auth: Telegram initData + JWT

## Estrutura

- apps/web: Mini App (Next.js)
- apps/api: API soberana (Fastify)
- packages/shared: schemas e types compartilhados
- docs: guias de setup

## Local development

```bash
cd ordem
pnpm install
pnpm dev
```

Web: http://localhost:3000/ordem
API: http://localhost:3001

## Dev helpers

- POST /dev/mock-users (NODE_ENV=development) to seed two local users.

## Self-check

```bash
pnpm lint
pnpm typecheck
```

## Environment

See `apps/api/.env.example` and `apps/web/.env.example`.

## Mini App setup

See `docs/telegram-miniapp-setup.md`.

## Changelog desta execução

Arquivos removidos:
- Nenhum.

Arquivos alterados:
- apps/api/src/lib/telegram.ts: expor hash do initData para anti-replay.
- apps/api/src/routes/telegram.ts: anti-replay, cookie 12h e rejeitar initDataUnsafe.
- apps/api/src/server.ts: aceitar Bearer apenas em desenvolvimento.
- apps/api/src/routes/ordem.ts: limites/anti-spam e payload 429 padronizado.
- apps/web/src/app/ordem/page.tsx: Bearer apenas em dev, cookie como padrão.
- apps/api/package.json: scripts de lint/typecheck.
- apps/web/package.json: scripts de lint/typecheck.
- packages/shared/package.json: scripts de lint/typecheck.
- package.json: scripts de lint/typecheck no workspace.
- docs/telegram-miniapp-setup.md: instrucoes do BotFather e checklist.
- README.md: estrutura, self-check e changelog.

Razoes:
- isolamento do Atlas, auth seguro, limites de abuso e docs unificadas.
