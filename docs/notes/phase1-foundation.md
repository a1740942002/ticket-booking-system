# Phase 1 學習筆記 — 核心流程地基

日期: 2026-05-30
相關文件: `docs/superpowers/specs/2026-05-30-concert-ticketing-system-design.md`、`docs/superpowers/plans/2026-05-30-phase1-core-flow.md`

## 做了什麼

搭好一個能跑的搶票系統地基，完成「瀏覽活動 → 下單 → mock 付款 → 出票」的完整流程，單人操作完全正確。

| 層 | 內容 |
|---|---|
| Monorepo | bun workspaces:`apps/web`、`apps/api`、`packages/shared` |
| 後端 | Hono + drizzle ORM，PostgreSQL（docker compose） |
| 前端 | Vite + React + Tailwind v4 + shadcn/ui |
| 共用 | `packages/shared` 放 zod schema，前後端共用型別 |

**API**:`POST /auth/login`、`GET /events`、`GET /events/:id`、`POST /orders`、`GET /orders/:id`、`POST /orders/:id/pay`

**資料表**:`users`、`events`、`ticket_zones`(含 `available_quantity`)、`orders`(狀態 `pending_payment | paid | expired | cancelled`)

## 關鍵決策（與原因）

- **資料庫選 PostgreSQL**:學習核心是併發控制，Postgres 提供 `SELECT ... FOR UPDATE`、原子 UPDATE、樂觀鎖、交易隔離等完整工具。SQLite 是單寫入者，看不到真實競態。
- **座位模型先用「區域數量」**:只記 `available_quantity` 計數，比「指定座位」單純，先聚焦併發問題本身（指定座位留到 Phase 6）。
- **認證簡化**:token 直接用 userId 字串，不做密碼/JWT。把篇幅留給核心。
- **付款用 mock**:重點在「下單 → 付款」的狀態流轉，不串真實金流。
- **共用 zod schema**:`CreateOrderRequest`、`LoginRequest` 放 `packages/shared`，後端 `.parse()` 驗證，前後端共用同一份契約。

## 刻意埋下的伏筆 ⚠️

`apps/api/src/routes/orders.ts` 的扣庫存是**故意天真**的「讀 → 改 → 寫」（第 15–23 行）:
讀出 `availableQuantity` → 在記憶體裡判斷與相減 → 寫回。

單人操作完全正確，但這是為了 Phase 2 **親眼見證超賣**而留的引信 —— 請勿在 Phase 3 之前「順手修好」它。

## 完成標準（已達成）

- `docker compose up -d` 起 postgres，migration 與 seed 成功
- `apps/api` 的 `bun test` 全綠（下單扣庫存、庫存不足擋下、付款轉 paid）
- 前端可走完「瀏覽 → 搶票 → 付款 → 出票」，單人下庫存扣減正確
- end-to-end 驗證:下單後 `availableQuantity` 正確由 100 → 99

## 啟動方式

```bash
docker compose up -d
cd apps/api && bun run db:seed     # 需要時灌種子（記得帶 DATABASE_URL）
cd apps/api && bun run dev          # 後端 :3000
cd apps/web && bun run dev          # 前端 :5173
```

## 下一步

Phase 2:寫併發測試，讓天真扣庫存的超賣現形（見 `phase2-oversell.md`）。
