# Phase 3 學習筆記 — 三種防超賣解法

日期: 2026-05-30
相關程式: `apps/api/src/routes/orders.ts`
相關測試: `apps/api/test/concurrency.test.ts`

## 問題回顧

Phase 2 證明了天真的「讀→改→寫」在併發下會超賣（100 人搶 10 張,賣出 100、剩餘庫存還是 9）。
根因:**檢查與扣減不是原子的**,而且決定是在應用程式記憶體裡做的,讀到的值寫回時早已過期。

核心修法:**讓「檢查 + 扣減」變成資料庫層級的單一原子操作,或把並發存取序列化。**

## 三種解法（都已實作為獨立端點,併發測試皆轉綠）

測試結果(100 人搶 10 張,全部不超賣):

| 端點 | 技巧 | 下單成功 | 剩餘庫存 |
|------|------|---------|---------|
| `POST /orders`            | ① 原子條件更新 | 10 | 0 |
| `POST /orders/lock`       | ② 悲觀鎖 FOR UPDATE | 10 | 0 |
| `POST /orders/optimistic` | ③ 樂觀鎖 version + 重試 | 10 | 0 |

---

### ① 原子條件更新（預設採用）

```sql
UPDATE ticket_zones
SET available_quantity = available_quantity - :qty
WHERE id = :id AND available_quantity >= :qty
```
扣多少由資料庫**在同一句 SQL 內**判斷與執行,回傳受影響列數:更新到 = 成功,0 列 = 庫存不足。
沒有「先讀再寫」的空窗,並發請求在該列上由資料庫自動序列化。

- ✅ 最簡單、最快、不需交易樣板,單句搞定。
- ✅ 沒有 lost update。
- ⚠️ 邏輯較複雜時(例如要連帶讀很多欄位再做多步判斷),全塞進一句 UPDATE 會吃力。
- **適用**:單純的「計數器扣減」—— 正是票券庫存這種場景的首選。

### ② 悲觀鎖 SELECT ... FOR UPDATE

```ts
db.transaction(async (tx) => {
  const zone = await tx.select()...where(id).for("update"); // 鎖住該列
  if (zone.available < qty) return 409;
  await tx.update(...).set({ available: zone.available - qty });
  ...
});
```
交易內先用 `FOR UPDATE` 鎖住該列,其他交易必須**排隊等鎖釋放**,所以讀到的一定是最新值。
仍是「讀→改→寫」,但鎖把並發序列化了。

- ✅ 直覺,可在鎖住後做任意複雜的多步邏輯。
- ✅ 沒有 lost update。
- ⚠️ 鎖競爭:高併發下大家排隊,吞吐下降;鎖持有時間越長越糟。
- ⚠️ 要小心死結(多列加鎖順序不一致時)。
- **適用**:一筆交易要鎖定並修改多個相關資料、邏輯複雜、無法塞進一句 UPDATE 時。

### ③ 樂觀鎖 version 欄位 + 重試

```ts
for (重試) {
  const zone = await read();                 // 讀出 version
  if (zone.available < qty) return 409;
  const updated = await update()
    .set({ available: zone.available - qty, version: zone.version + 1 })
    .where(id 且 version = 舊值);            // compare-and-swap
  if (updated) return 成功;
  // version 對不上 → 有人搶先 → 重讀重試
}
```
不上鎖。賭「沒人會同時改」,寫回時用 `WHERE version = 讀到的值` 檢查;沒中就重試。

- ✅ 無鎖,**低競爭**時吞吐最高。
- ✅ 沒有 lost update(version 不符就不會寫入)。
- ⚠️ **高競爭**時重試暴增、浪費 CPU,甚至重試耗盡而失敗(本實作 20 次上限後回 409)。
- ⚠️ 在「100 搶 10」這種超高競爭場景其實是最不划算的(這次剛好賣完,但競爭再高可能賣不滿)。
- **適用**:衝突機率低的場景(多數時候不會撞在一起),不想付鎖的成本。

## 結論與選擇

- 純庫存計數器 → **① 原子條件更新** 幾乎總是最佳解(本系統採用)。
- 需要鎖定多筆、做複雜交易邏輯 → **② 悲觀鎖**。
- 衝突罕見、讀多寫少 → **③ 樂觀鎖**。
- 搶票這種「極高競爭、單一熱點列」場景,悲觀鎖/原子更新比樂觀鎖穩;但所有解法最終都會卡在「同一列」這個瓶頸 —— 這正是 Phase 5 要用 Redis 預扣庫存來分流的動機。

## 下一步

Phase 4:庫存保留與逾時釋放(下單先保留 → 限時付款 → 逾時自動釋放),把訂單狀態機補完整。
