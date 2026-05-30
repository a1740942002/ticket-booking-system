# 🎫 演唱會搶票系統 (Ticket Booking System)

一個用於**學習系統設計**的演唱會搶票系統。重點不在功能多，而在於**循序漸進地解決高併發問題** —— 從「會超賣的天真版本」，一路演進到「擋得住高併發、且支援兩種座位模型」的系統。

每一個階段都是可運作的完整系統，並附一份學習筆記（`docs/notes/`），記錄問題成因、解法與取捨。

## ✨ 學習主線

| Phase | 主題 | 核心學習 | 筆記 |
|------|------|---------|------|
| 1 | 核心流程 | 跑通 monorepo 與端到端流程（**刻意天真扣庫存**） | [phase1](docs/notes/phase1-foundation.md) |
| 2 | 見證超賣 | Race condition / Lost update | [phase2](docs/notes/phase2-oversell.md) |
| 3 | 三種防超賣 | 原子條件更新 / 悲觀鎖 / 樂觀鎖 的取捨 | [phase3](docs/notes/phase3-prevent-oversell.md) |
| 4 | 保留與逾時釋放 | 背景掃描 + 付款把關、冪等釋放 | [phase4](docs/notes/phase4-reservation-timeout.md) |
| 5 | Redis 預扣庫存 | 熱點閘門前移、Redis/DB 一致性 | [phase5](docs/notes/phase5-redis-prededuct.md) |
| 6 | 指定座位 | 鎖的粒度：計數器 vs 具名資源 | [phase6](docs/notes/phase6-assigned-seats.md) |

> 每個 phase 也各有一個 git branch（`phase1`…`phase6`）當作階段快照，`git checkout phaseN` 即可回到當時狀態。

## 🛠 技術棧

- **語言 / Runtime**：TypeScript + [Bun](https://bun.sh)（workspaces monorepo）
- **前端**：Vite + React + TailwindCSS v4 + shadcn/ui
- **後端**：[Hono](https://hono.dev) + [Drizzle ORM](https://orm.drizzle.team)
- **資料庫**：PostgreSQL（併發控制的主角）
- **快取 / 閘門**：Redis（ioredis）
- **共用契約**：zod（前後端共用型別）
- **基礎設施**：Docker Compose（postgres + redis）

## 📁 專案結構

```
ticket-booking-system/
├── docker-compose.yml         # postgres + redis
├── apps/
│   ├── web/                   # Vite + React + Tailwind + shadcn
│   └── api/                   # Hono + drizzle
│       ├── src/
│       │   ├── db/            # schema、連線、種子
│       │   ├── routes/        # auth / events / orders / seats
│       │   └── orders/        # 下單、保留逾時、Redis 預扣
│       └── test/              # 併發 / 保留 / 座位 測試
├── packages/shared/           # 共用 zod schema
└── docs/
    ├── superpowers/           # 設計文件 (spec) 與實作計畫 (plan)
    └── notes/                 # 各 Phase 學習筆記
```

## 🚀 快速開始

需求：[Bun](https://bun.sh) ≥ 1.3、Docker。

```bash
# 1. 安裝依賴
bun install

# 2. 啟動 postgres + redis
docker compose up -d

# 3. 建立資料表並灌入種子資料
cd apps/api
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets
bun run db:migrate
bun run db:seed

# 4. 啟動後端（:3000）
bun run dev

# 5. 另開終端，啟動前端（:5173）
cd ../web
bun run dev
```

開啟 http://localhost:5173 →  瀏覽活動 → 搶票 → 付款 → 出票。

### 執行測試

併發測試是這個專案的核心，會反覆驗證「不超賣」這個不變量：

```bash
cd apps/api
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun test
```

## 🔌 API 一覽

| Method | Path | 說明 |
|--------|------|------|
| POST | `/auth/login` | 簡化登入（token = userId） |
| GET | `/events` | 活動列表 |
| GET | `/events/:id` | 活動詳情 + 票區 |
| POST | `/orders` | 下單 — **① 原子條件更新**（預設） |
| POST | `/orders/lock` | 下單 — **② 悲觀鎖** `SELECT FOR UPDATE` |
| POST | `/orders/optimistic` | 下單 — **③ 樂觀鎖** version + 重試 |
| POST | `/orders/redis` | 下單 — **Redis 預扣庫存**閘門 |
| GET | `/orders/:id` | 查訂單 |
| POST | `/orders/:id/pay` | mock 付款（success / fail） |
| GET | `/seats/zone/:zoneId` | 列出票區座位 |
| POST | `/seats/:id/claim` | 搶指定座位（座位級鎖） |

## 🧠 設計重點

- **防超賣**：把「檢查 + 扣減」做成資料庫層級的單一原子操作，或用鎖序列化並發；比較原子更新 / 悲觀鎖 / 樂觀鎖三種解法。
- **庫存保留**：下單即保留並設 `expires_at`；背景掃描自動釋放逾時保留，付款時再把關一次（兩道防線）。
- **高併發**：Redis 用 Lua 腳本做原子預扣，把大量必敗請求擋在進 DB 之前，DB 仍為真相來源。
- **座位模型**：區域數量（計數器）與指定座位（具名資源）共用同一套保留/逾時機制，差別只在鎖的粒度。

## ⚠️ 範圍說明

這是學習專案，刻意簡化了與「搶票核心」無關的部分：認證為簡化版（token = userId）、付款為 mock、未做前端選位圖。`apps/api/src/routes/orders.ts` 保留了多個下單端點純粹為了**對照不同併發解法**。

## 📄 文件

- 設計文件：[`docs/superpowers/specs/`](docs/superpowers/specs/)
- 實作計畫：[`docs/superpowers/plans/`](docs/superpowers/plans/)
- 學習筆記：[`docs/notes/`](docs/notes/)
