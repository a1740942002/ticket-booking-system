import { app } from "./app";
import { releaseExpiredOrders } from "./orders/expiry";
import { db } from "./db";
import { ticketZones } from "./db/schema";
import { syncZoneStockToRedis } from "./orders/redis-stock";

// 啟動暖機:把所有票區的庫存同步進 Redis 閘門。
const zones = await db.select({ id: ticketZones.id }).from(ticketZones);
await Promise.all(zones.map((z) => syncZoneStockToRedis(z.id)));
console.log(`[redis] 啟動同步 ${zones.length} 個票區庫存`);

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
