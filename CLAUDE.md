# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **system-design learning project**: a concert ticket-booking system that evolves, phase by phase, from a deliberately naïve "will oversell" version into one that survives high concurrency and supports two seating models. The point is the progression of concurrency-control solutions, not feature breadth. Each phase has a learning note in `docs/notes/phaseN-*.md` and a `phaseN` git branch snapshot (`git checkout phaseN`).

**Important:** The default order endpoint (`POST /orders`) is correct, but earlier phases and notes intentionally demonstrate broken/naïve approaches (e.g. lost-update oversell). Don't "fix" code that is deliberately buggy for teaching — check the phase note and surrounding comments before changing concurrency logic. The bilingual (Chinese) inline comments explain *why* each approach is chosen and its tradeoffs; preserve them.

## Commands

Runtime is **Bun** (≥ 1.3) with workspaces. There is no repo-wide test/lint/build script — run them per app.

```bash
bun install                      # install all workspace deps (from repo root)
docker compose up -d             # start postgres (:5432) + redis (:6379)  — or: bun run db:up
```

API (`apps/api/`, all commands need `DATABASE_URL` exported):
```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets
bun run db:migrate               # apply drizzle migrations
bun run db:seed                  # seed events/zones/seats (idempotent-ish; inserts a fresh event)
bun run dev                      # hot-reload server on :3000
bun test                         # run all tests
bun test test/concurrency.test.ts   # run a single test file
```

Web (`apps/web/`):
```bash
bun run dev      # vite dev server on :5173, proxies /api → :3000
bun run build    # tsc -b && vite build
bun run lint     # eslint
```

After editing `apps/api/src/db/schema.ts`, run `bun run db:generate` (in `apps/api/`) to create a new migration, then `db:migrate`.

### Tests need live infra and WIPE the database

Tests run against the **real** Postgres and Redis (no mocks, no test DB). Every test file's `beforeAll` does `db.delete(...)` on all tables, so **running `bun test` destroys your seed/dev data** — re-run `db:seed` afterward if you need the app populated. `redis-stock.test.ts` requires Redis to be up. Tests assert the core invariant directly: *sold ≤ stock and `availableQuantity == stock − sold ≥ 0`* (see `test/concurrency.test.ts`).

## Architecture

Monorepo: `apps/api` (backend), `apps/web` (frontend), `packages/shared` (zod contracts shared by both).

**Backend** — Hono + Drizzle ORM + `postgres` driver, Postgres as source of truth, Redis (ioredis) as an optional gate/cache.
- `src/app.ts` mounts route modules (`auth`, `events`, `orders`, `seats`) — pure, importable by tests with no side effects.
- `src/index.ts` is the **server entry point** and the only place with side effects: warms Redis stock keys from DB on boot, and starts the background sweep `setInterval`. Timers and warmup live here (not `app.ts`) specifically so tests importing `app` don't spawn them.
- `src/db/` — `schema.ts` (drizzle tables), `index.ts` (connection), `seed.ts`. Migrations in `drizzle/`.
- `src/orders/` — shared order logic: `create.ts` (`insertOrder`, sets `expiresAt` = reservation), `expiry.ts` (idempotent release of timed-out reservations), `redis-stock.ts` (Lua pre-deduct gate).
- `src/routes/` — HTTP handlers.

**The central theme is concurrency control.** `src/routes/orders.ts` exposes **four parallel order endpoints that solve the same oversell problem different ways** — they coexist on purpose, for comparison:
- `POST /orders` — **atomic conditional update** (default): single `UPDATE ... SET avail = avail - q WHERE avail >= q`. Check+decrement in one DB statement.
- `POST /orders/lock` — **pessimistic lock**: `SELECT ... FOR UPDATE` inside a transaction.
- `POST /orders/optimistic` — **optimistic lock**: read `version`, compare-and-swap on write, retry loop (`MAX_RETRIES = 20`).
- `POST /orders/redis` — **Redis pre-deduct gate** (Phase 5): atomic Lua check-and-decrement in Redis fronts the DB so doomed requests never hit Postgres; winners then do the DB atomic update. On DB drift/failure, stock is returned to Redis (best-effort; DB remains truth).

**Reservation lifecycle (two-line defense):** placing an order immediately reserves stock and sets `expiresAt`. (1) A background sweep (`releaseExpiredOrders`, every `SWEEP_INTERVAL_MS`, default 10s) releases timed-out `pending_payment` orders. (2) `POST /orders/:id/pay` also re-checks expiry at payment time, so correctness doesn't depend on sweep timing. Release is idempotent via `WHERE status = 'pending_payment'` so stock is never double-returned.

**Two seating models share one reservation/expiry mechanism**, differing only in lock granularity:
- **Quantity zones** (`ticket_zones.availableQuantity`) — a counter; the order endpoints above.
- **Assigned seats** (`seats` table, one row per seat, Phase 6) — named resources; `POST /seats/:id/claim` does an atomic `available → held` conditional update on the single seat row. Paying marks the seat `sold`; expiry returns it to `available`.

**Frontend** — Vite + React 19 + React Router + Tailwind v4 + shadcn/ui. `src/lib/api.ts` wraps the backend; all calls go through the `/api` proxy. Pages: events list → event detail → order/pay.

**Shared contracts** — `packages/shared/src/index.ts` exports zod schemas (`CreateOrderRequest`, `LoginRequest`, `OrderStatus`) imported by both apps as `@tickets/shared`.

## Conventions & simplifications (intentional)

- **Auth is fake:** login upserts a user and returns `token = String(userId)`. The `Authorization` header is parsed directly as the numeric userId. Don't build real auth unless asked — it's deliberately out of scope.
- Payment is a **mock** (`POST /orders/:id/pay` with `{ outcome: "success" | "fail" }`).
- Tunable via env: `RESERVATION_MS` (default 5min), `SWEEP_INTERVAL_MS` (default 10s), `REDIS_URL`, `DATABASE_URL`.
- Inline comments are in Chinese and carry the teaching content — keep them in sync when changing logic.
