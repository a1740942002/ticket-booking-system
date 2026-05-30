# Phase 4 學習筆記 — 庫存保留與逾時釋放

日期: 2026-05-30
相關程式: `apps/api/src/orders/expiry.ts`、`apps/api/src/routes/orders.ts`、`apps/api/src/index.ts`
相關測試: `apps/api/test/reservation.test.ts`

## 目標

把訂單狀態機補完整。真實搶票:下單只是「先把票**保留**起來」,使用者要在期限內付款;逾時沒付,
保留的庫存必須**自動釋放**回去給別人搶。

```
下單 → pending_payment ──付款成功──→ paid
                       ──逾時/付款時發現逾時──→ expired（釋放庫存）
```

## 做了什麼

1. **下單即保留**:`insertOrder` 在建立訂單時設 `expires_at = now + RESERVATION_MS`（預設 5 分鐘,
   可用環境變數 `RESERVATION_MS` 縮短以利測試）。庫存在下單當下就扣掉(保留)。

2. **釋放邏輯**(`orders/expiry.ts`):
   - `expireOrderIfPending(order)`:把單一「仍是 pending」的訂單原子地標成 `expired`,並把數量加回 `available_quantity`。
     用 `WHERE status = 'pending_payment'` 當守衛,確保**不會重複釋放**(若已被付款或已釋放就跳過)。
   - `releaseExpiredOrders(now?)`:掃出所有 `status = pending` 且 `expires_at < now` 的訂單,逐筆釋放,回傳釋放數。

3. **背景掃描器**(`index.ts`):`setInterval` 每隔 `SWEEP_INTERVAL_MS` 呼叫 `releaseExpiredOrders()`。
   **即使沒人去碰那筆訂單,被拋棄的票也會自動釋放** —— 這是搶票系統的關鍵。
   放在 server 進入點而非 `app.ts`,避免測試 import `app` 時誤啟動計時器。

4. **付款把關**(`/orders/:id/pay`):付款前若發現訂單已逾時(`expires_at < now`)但還沒被掃到,
   直接釋放並回 `409 reservation expired`。讓正確性**不依賴背景掃描的時機**(掃描只是兜底)。

## 兩道防線:為什麼同時要背景掃描 + 付款把關

| | 背景掃描 | 付款把關 |
|---|---|---|
| 角色 | 主動釋放被拋棄的保留 | 防止付款給一個已逾時的保留 |
| 沒有它會怎樣 | 拋棄的票永遠卡住,別人搶不到 | 掃描還沒跑時,逾時訂單可能被付款成功(不一致) |

兩者互補:掃描保證「最終會釋放」,把關保證「任一時刻付款都正確」。

## 設計重點 / 學到的

- **釋放要原子且冪等**:`UPDATE ... WHERE status = 'pending_payment'` 的回傳列數決定「我才是釋放它的人」,
  避免背景掃描與付款把關同時處理同一筆而把庫存加回兩次。
- **可測試性**:把釋放邏輯抽成純函式(`releaseExpiredOrders(now)` 可注入時間),
  setInterval 只負責「定期呼叫」。測試直接呼叫函式、用過去的 `expires_at` 模擬逾時,不必真的等 5 分鐘。
- 三個下單端點(原子/悲觀/樂觀)共用 `insertOrder`,所以都自動有了保留與逾時。

## 驗證

- 單元/整合測試 4 項全綠:設定 expires_at、釋放逾時加回庫存、付款時逾時擋下並釋放、正常付款不釋放。
- 實機驗證(縮短保留為 800ms):下單庫存 100→99,逾時後背景掃描自動 99→100,server log 印出
  `[sweep] 釋放了 1 筆逾時訂單的庫存`。

## 下一步

Phase 5:高併發進階。所有解法目前都卡在「同一個熱點列」,引入 Redis 預扣庫存擋掉大量請求、
排隊與限流,讓 DB 不被打爆。
