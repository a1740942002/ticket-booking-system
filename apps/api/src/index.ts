import { app } from "./app";
import { releaseExpiredOrders } from "./orders/expiry";

// 背景掃描器:定期釋放逾時未付款的保留庫存。
// 放在 server 進入點(不放 app.ts),避免測試 import app 時啟動計時器。
const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS ?? 10_000);
setInterval(() => {
  releaseExpiredOrders()
    .then((n) => {
      if (n > 0) console.log(`[sweep] 釋放了 ${n} 筆逾時訂單的庫存`);
    })
    .catch((e) => console.error("[sweep] 失敗", e));
}, SWEEP_INTERVAL_MS);

export default { port: 3000, fetch: app.fetch };
