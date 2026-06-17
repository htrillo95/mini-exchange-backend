# mini-exchange-backend

Express + TypeScript API for a paper trading exchange: in-memory order matching, WebSocket market updates, and optional Postgres persistence via Prisma.

## Requirements

- Node.js 20+
- PostgreSQL (for auth and persisted orders; demo mode works in-memory without a live DB)

## Setup

```bash
npm install
cp .env.example .env
# fill in JWT_SECRET and DATABASE_URL
npm run dev
```

Default URL: `http://localhost:4000`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run with tsx (hot reload) |
| `npm run build` | Prisma generate + TypeScript compile |
| `npm start` | Run compiled `dist/server.js` |

## Environment

See `.env.example`. Required at runtime:

- `JWT_SECRET` — signing key for auth tokens (app exits if missing)
- `DATABASE_URL` — Postgres connection string (Prisma)

Optional:

- `PORT` — default `4000`
- `JWT_EXPIRES_IN` — default `7d`
- `NODE_ENV` — `development` or `production`
- `CORS_ORIGIN` — required in production (frontend origin)

## API overview

Auth routes are mounted at `/auth` (not under `/api`).

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/auth/register` | No | Create account |
| POST | `/auth/login` | No | Returns JWT |
| GET | `/auth/me` | Bearer | Current user from token |
| POST | `/api/demo/start` | No | Start demo market bot |
| POST | `/api/demo/stop` | No | Stop demo bot |
| GET | `/api/demo/status` | No | Bot running state |
| GET | `/api/orders/book` | No | In-memory order book |
| GET | `/api/orders/trades` | No | Recent in-memory trades |
| POST | `/api/orders/demo` | No | Submit demo order (no DB) |
| POST | `/api/orders` | Bearer | Submit order (persisted) |
| GET | `/api/orders/open` | Bearer | User open orders |
| GET | `/api/orders/history` | Bearer | User order history |
| DELETE | `/api/orders/:id` | Bearer | Cancel order |
| GET | `/api/market/candles` | No | OHLC candles from in-memory trades (`?interval=1\|5\|15\|60`) |
| GET | `/api/account` | Bearer | User balance |
| GET | `/api/account/positions` | Bearer | User positions |

WebSocket shares the HTTP server port for live `market_update` events.

## Demo mode

Call `POST /api/demo/start` to run the simulated market. Book, trades, and candles use the in-memory matching engine and do not require Postgres.

Authenticated order flows still use Prisma when the database is available.
