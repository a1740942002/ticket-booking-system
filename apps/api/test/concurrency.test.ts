import { expect, test, beforeAll } from "bun:test";
import { app } from "../src/app";
import { db } from "../src/db";
import { events, ticketZones, orders, users } from "../src/db/schema";
import { eq } from "drizzle-orm";

// Phase 2:用併發證明 Phase 1 的天真扣庫存會超賣。
// 100 個人同時搶只有 10 張的票區 —— 正確的系統最多賣出 10 張。

const BUYERS = 100;
const STOCK = 10;

let zoneId: number;
let buyerIds: number[];

beforeAll(async () => {
  await db.delete(orders);
  await db.delete(ticketZones);
  await db.delete(events);
  await db.delete(users);

  const createdUsers = await db
    .insert(users)
    .values(Array.from({ length: BUYERS }, (_, i) => ({ username: `buyer_${i}` })))
    .returning();
  buyerIds = createdUsers.map((u) => u.id);

  const [event] = await db
    .insert(events)
    .values({ title: "搶票壓力測試", venue: "場館", eventDate: new Date("2026-12-31T20:00:00Z") })
    .returning();

  const [zone] = await db
    .insert(ticketZones)
    .values({ eventId: event.id, name: "限量區", price: "1000", totalQuantity: STOCK, availableQuantity: STOCK })
    .returning();
  zoneId = zone.id;
});

test("100 人同時搶 10 張票:售出數量不應超過庫存", async () => {
  // 同一瞬間發出 100 個下單請求
  const responses = await Promise.all(
    buyerIds.map((uid) =>
      app.request("/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: String(uid) },
        body: JSON.stringify({ zoneId, quantity: 1 }),
      }),
    ),
  );

  const succeeded = responses.filter((r) => r.status === 200).length;
  const rejected = responses.filter((r) => r.status === 409).length;

  // 從 DB 看真實結果
  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, zoneId));
  const placedOrders = await db.select().from(orders).where(eq(orders.zoneId, zoneId));

  console.log("\n========== 併發結果 ==========");
  console.log(`下單成功 (200):       ${succeeded}`);
  console.log(`被擋下 (409 缺貨):    ${rejected}`);
  console.log(`實際建立的訂單數:     ${placedOrders.length}`);
  console.log(`剩餘庫存 availableQty: ${zone.availableQuantity}  (應該 >= 0)`);
  console.log(`總票數 totalQuantity:  ${zone.totalQuantity}`);
  console.log(`超賣張數:             ${Math.max(0, placedOrders.length - zone.totalQuantity)}`);
  console.log("==============================\n");

  // 不變量:售出的票不該超過總庫存，剩餘庫存不該為負
  expect(placedOrders.length).toBeLessThanOrEqual(zone.totalQuantity);
  expect(zone.availableQuantity).toBeGreaterThanOrEqual(0);
});
