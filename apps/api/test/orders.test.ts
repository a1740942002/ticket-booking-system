import { expect, test, beforeAll } from "bun:test";
import { app } from "../src/app";
import { db } from "../src/db";
import { events, ticketZones, orders, users } from "../src/db/schema";
import { eq } from "drizzle-orm";

let zoneId: number;
let userId: number;

beforeAll(async () => {
  // 清空並建立乾淨測試資料
  await db.delete(orders);
  await db.delete(ticketZones);
  await db.delete(events);
  await db.delete(users);
  const [u] = await db.insert(users).values({ username: "tester" }).returning();
  userId = u.id;
  const [e] = await db.insert(events).values({
    title: "測試演唱會", venue: "場館", eventDate: new Date("2026-12-31T20:00:00Z"),
  }).returning();
  const [z] = await db.insert(ticketZones).values({
    eventId: e.id, name: "區A", price: "1000", totalQuantity: 10, availableQuantity: 10,
  }).returning();
  zoneId = z.id;
});

test("下單成功並正確扣減庫存", async () => {
  const res = await app.request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ zoneId, quantity: 2 }),
  });
  expect(res.status).toBe(200);
  const order = await res.json();
  expect(order.status).toBe("pending_payment");

  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, zoneId));
  expect(zone.availableQuantity).toBe(8);
});

test("庫存不足時下單失敗", async () => {
  const res = await app.request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ zoneId, quantity: 999 }),
  });
  expect(res.status).toBe(409);
});

test("付款後訂單變為 paid", async () => {
  const createRes = await app.request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ zoneId, quantity: 1 }),
  });
  const order = await createRes.json();

  const payRes = await app.request(`/orders/${order.id}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ outcome: "success" }),
  });
  expect(payRes.status).toBe(200);
  const paid = await payRes.json();
  expect(paid.status).toBe("paid");
});
