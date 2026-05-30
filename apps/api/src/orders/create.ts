import { db } from "../db";
import { orders, ticketZones } from "../db/schema";

// 保留時間:下單後多久內必須付款,逾時釋放。預設 5 分鐘,可用環境變數縮短以利測試。
export const RESERVATION_MS = Number(process.env.RESERVATION_MS ?? 5 * 60 * 1000);

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Zone = typeof ticketZones.$inferSelect;

// 共用:把訂單寫進 orders 表,下單即「保留」並設 expires_at。
// seatId 只有指定座位訂單會帶（Phase 6）。exec 可以是 db 或交易 tx。
export async function insertOrder(
  exec: Executor,
  userId: number,
  zone: Zone,
  quantity: number,
  seatId?: number,
) {
  const totalPrice = String(Number(zone.price) * quantity);
  const expiresAt = new Date(Date.now() + RESERVATION_MS);
  const [order] = await exec
    .insert(orders)
    .values({ userId, zoneId: zone.id, seatId, quantity, totalPrice, status: "pending_payment", expiresAt })
    .returning();
  return order;
}
