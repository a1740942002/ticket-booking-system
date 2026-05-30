# Phase 6 學習筆記 — 指定座位（座位級鎖）

日期: 2026-05-30
相關程式: `apps/api/src/db/schema.ts`(`seats`)、`apps/api/src/routes/seats.ts`、`apps/api/src/orders/expiry.ts`、`apps/api/src/routes/orders.ts`(pay)、`apps/api/src/orders/create.ts`
相關測試: `apps/api/test/seats.test.ts`

## 兩種併發問題的對比

| | 區域數量（Phase 1–5） | 指定座位（Phase 6） |
|---|---|---|
| 資源 | 一個計數器 `available_quantity` | 每個座位一列 `seats` |
| 問題 | 計數器扣減不能超賣 | 同一具名資源不可被兩人佔用 |
| 鎖粒度 | 整個票區一個熱點 | 每個座位獨立 |
| 解法 | `UPDATE ... SET q=q-1 WHERE q>=1` | `UPDATE seats SET status='held' WHERE id=? AND status='available'` |

兩者其實是**同一招原子條件更新**(Phase 3 ①)的兩種應用:把「判斷 + 佔用」壓進單一 UPDATE,
靠 `WHERE` 條件 + 回傳列數決定輸贏。差別只在鎖的**粒度**:計數器是單一熱點,座位是天然分散(不同座位互不競爭)。

## 座位生命週期

```
available ──claim搶到──→ held ──付款成功──→ sold
                          └──逾時/未付款──→ available（釋放）
```

## 實作重點

- **搶位**(`POST /seats/:id/claim`):原子條件更新 `available → held`。同一座位 N 人搶,只有 1 個 UPDATE 會更新到那列,其餘回傳 0 列 → 409。搶到的人接著建立保留訂單(帶 `seatId`,設 `expires_at`)。
- **保留/逾時**沿用 Phase 4:`expireOrderIfPending` 用 returning 的訂單列判斷 ——
  有 `seatId` → 把**座位**放回 `available`;否則 → 把**數量**加回票區(並回補 Redis)。一套逾時機制同時服務兩種模型。
- **付款**:成功時若訂單有 `seatId`,把座位標成 `sold`。
- 共用的 `insertOrder` 抽到 `orders/create.ts`,加上選填 `seatId`,讓區域訂單與座位訂單共用同一套保留邏輯。

## 實測

```
[同一座位] 100 人搶 → 成功=1  被擋(409)=99      （座位 held）
[不同座位] 100 人各搶不同位 → 全部成功=100
逾時未付款 → 背景掃描把座位放回 available
付款成功 → 座位 sold
```
實機(HTTP):5 人同搶 A-1 → 恰好 1 成功、4 被擋,座位轉 held。

## 範圍說明 / 後續

- 本 phase 聚焦**後端座位級併發**;前端選位圖(seat map UI)未做,屬另一塊較大的 UI 工作。
- 真實對號系統還會有:座位狀態即時推播(WebSocket)、暫時鎖定的視覺倒數、相鄰座位批次選取等,皆可在此基礎上延伸。

## 專案回顧（Phase 1–6）

1. 核心流程跑通(天真扣庫存) → 2. 見證超賣 → 3. 三種防超賣(原子/悲觀/樂觀) →
4. 庫存保留與逾時釋放 → 5. Redis 預扣擋流量 → 6. 指定座位(座位級鎖)。

一條從「會壞」到「擋得住高併發、且支援兩種座位模型」的完整演進。
