import { expect, test, beforeEach } from "bun:test";
import { app } from "../src/app";
import { db } from "../src/db";
import { events, ticketZones, orders, users, seats } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { releaseExpiredOrders } from "../src/orders/expiry";

// Phase 6:指定座位。鎖的粒度 = 單一座位,同一座位不可被兩人搶到。

const N = 100;
let userIds: number[];
let seatIds: number[];

beforeEach(async () => {
  await db.delete(orders);
  await db.delete(seats);
  await db.delete(ticketZones);
  await db.delete(events);
  await db.delete(users);

  const us = await db
    .insert(users)
    .values(Array.from({ length: N }, (_, i) => ({ username: `buyer_${i}` })))
    .returning();
  userIds = us.map((u) => u.id);

  const [event] = await db
    .insert(events)
    .values({ title: "對號入座場", venue: "場館", eventDate: new Date("2026-12-31T20:00:00Z") })
    .returning();
  const [zone] = await db
    .insert(ticketZones)
    .values({ eventId: event.id, name: "對號區", price: "1000", totalQuantity: N, availableQuantity: N })
    .returning();

  const ss = await db
    .insert(seats)
    .values(Array.from({ length: N }, (_, i) => ({ zoneId: zone.id, label: `S-${i}` })))
    .returning();
  seatIds = ss.map((s) => s.id);
});

function claim(seatId: number, userId: number) {
  return app.request(`/seats/${seatId}/claim`, {
    method: "POST",
    headers: { Authorization: String(userId) },
  });
}

test("100 人同時搶同一個座位:只有 1 人成功", async () => {
  const target = seatIds[0];
  const responses = await Promise.all(userIds.map((uid) => claim(target, uid)));

  const ok = responses.filter((r) => r.status === 200).length;
  const rejected = responses.filter((r) => r.status === 409).length;
  console.log(`\n[同一座位] 成功=${ok}  被擋(409)=${rejected}`);

  expect(ok).toBe(1);
  expect(rejected).toBe(N - 1);
  const [seat] = await db.select().from(seats).where(eq(seats.id, target));
  expect(seat.status).toBe("held");
  const placed = await db.select().from(orders).where(eq(orders.seatId, target));
  expect(placed.length).toBe(1);
});

test("100 人各搶不同座位:全部成功", async () => {
  const responses = await Promise.all(userIds.map((uid, i) => claim(seatIds[i], uid)));
  const ok = responses.filter((r) => r.status === 200).length;
  console.log(`[不同座位] 成功=${ok}`);

  expect(ok).toBe(N);
  const held = await db.select().from(seats).where(eq(seats.status, "held"));
  expect(held.length).toBe(N);
});

test("座位逾時未付款 → 背景釋放回 available", async () => {
  const target = seatIds[0];
  const order = await (await claim(target, userIds[0])).json();
  expect((await db.select().from(seats).where(eq(seats.id, target)))[0].status).toBe("held");

  await db.update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));
  expect(await releaseExpiredOrders()).toBe(1);

  const [seat] = await db.select().from(seats).where(eq(seats.id, target));
  expect(seat.status).toBe("available");
});

test("付款成功 → 座位變 sold", async () => {
  const target = seatIds[0];
  const order = await (await claim(target, userIds[0])).json();
  const pay = await app.request(`/orders/${order.id}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userIds[0]) },
    body: JSON.stringify({ outcome: "success" }),
  });
  expect(pay.status).toBe(200);
  const [seat] = await db.select().from(seats).where(eq(seats.id, target));
  expect(seat.status).toBe("sold");
});
