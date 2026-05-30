# Phase 5 學習筆記 — Redis 預扣庫存（入場閘門）

日期: 2026-05-30
相關程式: `apps/api/src/redis.ts`、`apps/api/src/orders/redis-stock.ts`、`apps/api/src/routes/orders.ts`(`POST /orders/redis`)、`apps/api/src/orders/expiry.ts`、`apps/api/src/index.ts`
相關測試: `apps/api/test/redis-stock.test.ts`
基礎設施: `docker-compose.yml` 新增 redis 服務;client 用 `ioredis`

## 問題

Phase 3 的三種解法雖然都不超賣,但**每個請求都打到 Postgres**,而且全部卡在「同一個熱點資料列」。
100 人搶 10 張,有 90 個註定失敗的請求還是各自進了 DB 競爭那一列 —— DB 是最貴、最容易被打爆的環節。

## 解法:把「搶庫存」這道閘門前移到 Redis

Redis 單執行緒 + 記憶體操作,把 check-and-decrement 寫成一段 **Lua 腳本**(整段原子執行):

```lua
local cur = redis.call('GET', KEYS[1])
if cur == false then return -1 end          -- 未初始化
cur = tonumber(cur); local qty = tonumber(ARGV[1])
if cur < qty then return -2 end             -- 庫存不足
return redis.call('DECRBY', KEYS[1], qty)   -- 成功,回傳新剩餘
```

`POST /orders/redis` 流程:
1. **Redis 預扣(閘門)**:搶不到的請求(`-2`)在這裡直接回 409 —— **完全不碰 Postgres**。
2. **過閘的贏家**才進 DB:沿用 Phase 3 原子扣減 + Phase 4 保留(設 `expires_at`)。
3. **回補**:若 DB 與 Redis 漂移(DB 扣不動)或 DB 出錯,把 Redis `INCRBY` 加回去(rollback)。

## 實測（100 人搶 10 張）

```
過閘成功=10  被擋(409)=90  進 DB 的訂單=10  DB剩餘=0  Redis剩餘=0
```
**只有 10 筆進到 Postgres**,90 個必敗請求在 Redis 就被擋掉 —— 這就是「擋住 thundering herd」。
對比 Phase 3:同樣不超賣,但那時 100 個請求全都打到了 DB。

## 一致性:Redis 是閘門,Postgres 是真相

兩個地方都記庫存 → 必須處理同步,這是這個架構最容易出錯的地方:

| 事件 | Redis | Postgres | 同步做法 |
|------|-------|----------|---------|
| 暖機 | `SET stock = available` | (來源) | 啟動時 / 首次請求 `-1` 時從 DB 灌入 |
| 下單成功 | `DECRBY`(閘門先扣) | 原子扣減 + 建訂單 | 贏家才進 DB |
| DB 漂移/失敗 | `INCRBY` 回補 | 不動 | rollback Redis |
| 逾時釋放(Phase 4) | `INCRBY` 回補(best-effort) | 加回 available | 釋放時兩邊都還 |

原則:**DB 是真相來源,Redis 是擋流量的快取/閘門。** 還庫存回 Redis 採 best-effort(失敗只記 log 不中斷),
因為就算 Redis 暫時不同步,DB 仍正確;Redis 偏少頂多少賣一點,不會超賣。

## 取捨與尚未解決的

- ✅ 擋住大量必敗請求、DB 壓力大降、仍不超賣。
- ⚠️ **Redis 與 DB 的最終一致性**靠程式自律維持;當機/重啟需要可靠的暖機與對帳(目前只在啟動時同步)。
- ⚠️ Redis 那把 key 仍是單一熱點,但記憶體原子操作比 DB 行鎖快非常多,瓶頸大幅後移。
- ⚠️ 真要再擴:還可加**排隊/限流**(本 phase 範圍外,留待後續),把進場速率也壓在 Redis。

## 下一步

Phase 6:延伸到「指定座位」模型 —— 鎖的粒度從「區域計數」變成「單一座位」,
示範選位的併發(同一座位不可被兩人搶到)。
