import { db } from "../db";
import { orders, ticketZones } from "../db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { returnStockToRedis } from "./redis-stock";

// 保留時間:下單後多久內必須付款,逾時釋放。預設 5 分鐘,可用環境變數縮短以利測試。
export const RESERVATION_MS = Number(process.env.RESERVATION_MS ?? 5 * 60 * 1000);

type Order = typeof orders.$inferSelect;

// 把單一「仍是 pending 的逾時訂單」標為 expired,並把保留的庫存原子地加回去。
// WHERE 帶 status = pending_payment 確保不會重複釋放(若已被付款/釋放就跳過)。
// 回傳是否真的釋放了。
export async function expireOrderIfPending(order: Pick<Order, "id" | "zoneId" | "quantity">) {
  const released = await db
    .update(orders)
    .set({ status: "expired" })
    .where(and(eq(orders.id, order.id), eq(orders.status, "pending_payment")))
    .returning();

  if (released.length === 0) return false;

  await db
    .update(ticketZones)
    .set({ availableQuantity: sql`${ticketZones.availableQuantity} + ${order.quantity}` })
    .where(eq(ticketZones.id, order.zoneId));

  // 同步把票還回 Redis 閘門(best-effort;DB 已是真相)
  await returnStockToRedis(order.zoneId, order.quantity);

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
