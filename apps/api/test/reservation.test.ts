import { expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { db } from "../src/db";
import { events, ticketZones, orders, users, seats } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { releaseExpiredOrders } from "../src/orders/expiry";

// Phase 4:庫存保留與逾時釋放。

let zoneId: number;
let userId: number;

beforeEach(async () => {
  await db.delete(orders);
  await db.delete(seats);
  await db.delete(ticketZones);
  await db.delete(events);
  await db.delete(users);
  const [u] = await db.insert(users).values({ username: "tester" }).returning();
  userId = u.id;
  const [e] = await db
    .insert(events)
    .values({ title: "保留測試", venue: "場館", eventDate: new Date("2026-12-31T20:00:00Z") })
    .returning();
  const [z] = await db
    .insert(ticketZones)
    .values({ eventId: e.id, name: "區A", price: "1000", totalQuantity: 5, availableQuantity: 5 })
    .returning();
  zoneId = z.id;
});

async function placeOrder(quantity: number) {
  const res = await app.request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ zoneId, quantity }),
  });
  return res.json();
}

async function getAvailable() {
  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, zoneId));
  return zone.availableQuantity;
}

test("下單會設定 expires_at（保留庫存）", async () => {
  const order = await placeOrder(2);
  expect(order.status).toBe("pending_payment");
  expect(order.expiresAt).not.toBeNull();
  expect(new Date(order.expiresAt).getTime()).toBeGreaterThan(Date.now());
  expect(await getAvailable()).toBe(3); // 5 - 2 已保留
});

test("releaseExpiredOrders 釋放逾時訂單並加回庫存", async () => {
  const order = await placeOrder(2);
  expect(await getAvailable()).toBe(3);

  // 把這筆訂單的 expires_at 改到過去,模擬逾時
  await db.update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));

  const released = await releaseExpiredOrders();
  expect(released).toBe(1);

  const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
  expect(after.status).toBe("expired");
  expect(await getAvailable()).toBe(5); // 庫存已釋放回來
});

test("付款時若已逾時 → 回 409 並釋放庫存", async () => {
  const order = await placeOrder(2);
  await db.update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));

  const res = await app.request(`/orders/${order.id}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ outcome: "success" }),
  });
  expect(res.status).toBe(409);

  const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
  expect(after.status).toBe("expired");
  expect(await getAvailable()).toBe(5); // 釋放
});

test("未逾時的正常付款 → paid,庫存維持保留不釋放", async () => {
  const order = await placeOrder(2);
  const res = await app.request(`/orders/${order.id}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ outcome: "success" }),
  });
  expect(res.status).toBe(200);
  const paid = await res.json();
  expect(paid.status).toBe("paid");
  expect(await getAvailable()).toBe(3); // 已售出,不釋放

  // 逾時掃描不應動到已付款的訂單
  await db.update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));
  expect(await releaseExpiredOrders()).toBe(0);
  expect(await getAvailable()).toBe(3);
});
