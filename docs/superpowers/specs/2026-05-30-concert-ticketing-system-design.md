# 演唱會搶票系統 — 設計文件

日期: 2026-05-30
狀態: 已核准設計，待 review

## 目標

打造一個用於**學習系統設計**的演唱會搶票系統。學習主軸為「高併發下的庫存正確性」。
採循序漸進方式:先做出單人正確、但多人會超賣的天真版本，親眼見證 race condition，
再一步步用資料庫鎖、狀態機、Redis 等技巧解決。

每個 Phase 結束時，系統都應為可運作、可展示的完整狀態。

## 技術選型

- **Monorepo**: bun workspaces
- **語言**: TypeScript（全棧）
- **前端**: Vite + React + TailwindCSS + shadcn/ui
- **後端**: Hono + drizzle ORM
- **資料庫**: PostgreSQL
  - 選擇理由:提供完整的併發控制工具（`SELECT ... FOR UPDATE`、樂觀鎖、交易隔離等級），
    能真實示範競態與解法。SQLite 為單寫入者，看不到真實競態。
- **快取/併發**: Redis（Phase 5 引入）
- **基礎設施**: docker compose 啟動 postgres + redis
- **共用驗證**: zod（前後端共用型別與 API schema）

## Monorepo 結構

```
ticket-booking-system/
├── package.json              # bun workspaces 根
├── docker-compose.yml        # postgres + redis
├── apps/
│   ├── web/                  # Vite + React + Tailwind + shadcn/ui
│   └── api/                  # Hono + drizzle
├── packages/
│   └── shared/               # 共用型別 (zod schema: Event, Order, API...)
└── docs/superpowers/specs/   # 設計文件
```

`packages/shared` 放前後端共用的 TypeScript 型別與 zod schema，確保前端呼叫 API 型別安全。

## 範圍決策

| 面向 | 決策 | 理由 |
|------|------|------|
| 座位模型 | 先「區域數量」，Phase 6 再延伸「指定座位」 | 區域數量模型較單純，先聚焦併發問題本身 |
| 認證 | 簡化版（username + token） | 把精力留給核心併發，不在認證上耗篇幅 |
| 付款 | Mock 付款（可模擬成功/失敗/逾時） | 重點在「保留庫存→限時付款→逾時釋放」狀態機 |
| 學習方式 | 先寫有 bug 的天真版，再用併發測試見證、修復 | 學習效果最強 |

## 資料模型（Phase 1）

```
users
  id, username, created_at

events                       # 一場演唱會
  id, title, venue, event_date, status, created_at

ticket_zones                 # 一場活動下的票區 (搖滾區/看台A...)
  id, event_id, name, price,
  total_quantity,            # 總票數
  available_quantity         # 剩餘（Phase 1 天真扣減的對象）

orders                       # 一筆訂單
  id, user_id, zone_id, quantity, total_price,
  status,                    # pending_payment | paid | expired | cancelled
  expires_at,                # Phase 4 才使用
  created_at
```

後續 Phase 會逐步擴充:Phase 3 可能加 `version` 欄位（樂觀鎖）；Phase 6 新增 `seats` 表。

## 核心 API（Hono）

```
POST /auth/login              # 簡化登入，回 token
GET  /events                  # 活動列表
GET  /events/:id              # 活動詳情 + 票區與剩餘數量
POST /orders                  # 下單（扣庫存）← 併發戰場
POST /orders/:id/pay          # mock 付款
GET  /orders/:id              # 查訂單狀態
```

## 訂單狀態機（Phase 4 完整版）

```
下單 → pending_payment ──付款成功──→ paid
                       ──逾時(expires_at)──→ expired（釋放保留的庫存）
                       ──取消──→ cancelled（釋放保留的庫存）
```

Phase 1 簡化:下單後直接 `paid`，尚無保留與逾時。

## 循序漸進路線圖

每個 Phase 都是可運作的完整系統。

### Phase 1 — 核心流程跑通（單人正確、多人會爆）
- 區域數量模型。建立 users / events / ticket_zones / orders 資料表。
- 完整流程:瀏覽活動 → 選區域數量 → 下單 → mock 付款（直接成功）→ 出票。
- **故意天真的庫存扣減**:讀 `available_quantity` → 記憶體中減 → 寫回。單人完全正確。
- 前端:活動列表、活動詳情、下單頁、訂單狀態頁。
- 驗證:手動操作整個流程成功，訂單與庫存數字正確。

### Phase 2 — 親眼見證 Bug（超賣）
- 寫併發測試腳本:模擬 100 人同時搶最後 10 張票。
- 驗證:觀察到 `available_quantity` 變負數 / 售出超過庫存。確認 race condition 存在。

### Phase 3 — 用資料庫解決超賣
- 依序示範並比較三種技巧:
  1. 原子更新 `UPDATE ... SET available_quantity = available_quantity - :n WHERE available_quantity >= :n`
  2. 悲觀鎖 `SELECT ... FOR UPDATE`
  3. 樂觀鎖（`version` 欄位 + 失敗重試）
- 驗證:重跑 Phase 2 併發測試，售出數量 = 庫存，不再超賣。

### Phase 4 — 庫存保留與逾時釋放（狀態機）
- 下單時「保留」庫存，狀態 `pending_payment`，設 `expires_at`（如 5 分鐘）。
- mock 付款可選成功/失敗。付款成功 → `paid`。
- 背景任務（或查詢時惰性檢查）將逾時訂單設為 `expired` 並釋放庫存。
- 驗證:下單後不付款，逾時後庫存正確回補；他人可再次搶到。

### Phase 5 — 高併發進階（引入 Redis）
- Redis 預扣庫存:擋掉大量無效請求，不全打到 DB。
- 排隊機制 / 限流。
- 防超賣的分散式鎖。
- 驗證:高併發測試下，吞吐量提升且仍不超賣；DB 壓力下降。

### Phase 6 — 延伸到指定座位模型
- 新增 `seats` 表，鎖粒度變成「單一座位」。
- 示範選位的併發處理（同一座位不可被兩人搶到）。
- 驗證:併發選同一座位，只有一人成功。

## 測試策略

- 每個 Phase 有對應的驗證方式（見上）。
- 核心是 **併發測試腳本**（Phase 2 起），用來反覆驗證「不超賣」這個不變量（invariant）。
- 不變量檢查:任何時刻 `已售出 <= total_quantity`，`available_quantity >= 0`。

## 非目標（YAGNI）

- 完整使用者系統（email 驗證、OAuth、密碼重設）
- 真實金流串接
- 多場館/多活動的後台管理介面（僅最小可展示）
- 退票、改票、座位升等等進階票務功能
