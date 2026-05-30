import { db } from "../db";
import { orders, ticketZones, seats } from "../db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { returnStockToRedis } from "./redis-stock";

type Order = typeof orders.$inferSelect;

// 把單一「仍是 pending 的逾時訂單」標為 expired,並釋放它佔用的資源。
// WHERE 帶 status = pending_payment 確保不會重複釋放(若已被付款/釋放就跳過)。
// 用 returning 拿到的那一列來決定釋放方式,回傳是否真的釋放了。
export async function expireOrderIfPending(order: Pick<Order, "id">) {
  const [released] = await db
    .update(orders)
    .set({ status: "expired" })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending_payment")))
    .returning();

  if (!released) return false;

  if (released.seatId) {
    // 指定座位訂單:把座位放回 available（Phase 6）
    await db.update(seats).set({ status: "available" }).where(eq(seats.id, released.seatId));
  } else {
    // 區域數量訂單:把數量加回 DB,並同步還回 Redis 閘門(best-effort)
    await db
      .update(ticketZones)
      .set({ availableQuantity: sql`${ticketZones.availableQuantity} + ${released.quantity}` })
      .where(eq(ticketZones.id, released.zoneId));
    await returnStockToRedis(released.zoneId, released.quantity);
  }

  return true;
}

// 掃出所有逾時且仍 pending 的訂單,逐筆釋放。回傳實際釋放數量。
// 背景任務定期呼叫;now 參數方便測試注入時間。
export async function releaseExpiredOrders(now: Date = new Date()) {
  const expired = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, "pending_payment"), lt(orders.expiresAt, now)));

  let releasedCount = 0;
  for (const order of expired) {
    if (await expireOrderIfPending(order)) releasedCount++;
  }
  return releasedCount;
}
