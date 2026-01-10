# Academia (Frontend)

Projeto Vite + React para a interface da Academia.

## Requisitos
- Node.js 20.19+ ou 22.12+

## Setup rapido
1) Crie `.env` baseado em `.env.example`.
2) Instale dependencias: `npm install`
3) Inicie o frontend: `npm run dev`

## OAuth
O frontend conversa com `academia/auth-api`.
- Configure `VITE_AUTH_API_BASE` para apontar para o backend.
- `VITE_AUTH_ENABLE_META` e `VITE_AUTH_ENABLE_GITHUB` controlam os providers.
- `VITE_AUTH_SHOW_DASHBOARD` mostra o card de conversao por provider.

Para iniciar o backend, veja `academia/auth-api/README.md`.
