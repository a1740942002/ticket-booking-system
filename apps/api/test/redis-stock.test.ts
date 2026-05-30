import { expect, test, beforeAll, afterAll } from "bun:test";
import { app } from "../src/app";
import { db } from "../src/db";
import { events, ticketZones, orders, users, seats } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { syncZoneStockToRedis, stockKey } from "../src/orders/redis-stock";
import { redis } from "../src/redis";

// Phase 5:Redis 預扣庫存當入場閘門。100 人搶 10 張,恰好 10 過閘進 DB,其餘 90 在 Redis 被擋。

const BUYERS = 100;
const STOCK = 10;

let zoneId: number;
let buyerIds: number[];

beforeAll(async () => {
  await db.delete(orders);
  await db.delete(seats);
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
    .values({ title: "Redis 壓測", venue: "場館", eventDate: new Date("2026-12-31T20:00:00Z") })
    .returning();

  const [zone] = await db
    .insert(ticketZones)
    .values({ eventId: event.id, name: "限量區", price: "1000", totalQuantity: STOCK, availableQuantity: STOCK })
    .returning();
  zoneId = zone.id;
});

afterAll(async () => {
  await redis.del(stockKey(zoneId));
  redis.disconnect();
});

test("Redis 預扣:100 搶 10,恰好 10 過閘且不超賣,其餘在 Redis 被擋", async () => {
  // 重設 DB 與 Redis 庫存為滿
  await db.delete(orders);
  await db.update(ticketZones).set({ availableQuantity: STOCK, version: 0 }).where(eq(ticketZones.id, zoneId));
  await syncZoneStockToRedis(zoneId);

  const responses = await Promise.all(
    buyerIds.map((uid) =>
      app.request("/orders/redis", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: String(uid) },
        body: JSON.stringify({ zoneId, quantity: 1 }),
      }),
    ),
  );

  const ok = responses.filter((r) => r.status === 200).length;
  const rejected = responses.filter((r) => r.status === 409).length;
  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, zoneId));
  const placed = await db.select().from(orders).where(eq(orders.zoneId, zoneId));
  const redisLeft = Number(await redis.get(stockKey(zoneId)));

  console.log(
    `\n[Redis 預扣] 過閘成功=${ok}  被擋(409)=${rejected}  進 DB 的訂單=${placed.length}  DB剩餘=${zone.availableQuantity}  Redis剩餘=${redisLeft}`,
  );

  expect(ok).toBe(STOCK); // 恰好 10 人過閘
  expect(rejected).toBe(BUYERS - STOCK); // 其餘 90 在 Redis 就被擋(沒打 DB)
  expect(placed.length).toBe(STOCK); // 只有 10 筆進 DB → 證明 herd 被 Redis 吸收
  expect(zone.availableQuantity).toBe(0); // DB 不超賣
  expect(redisLeft).toBe(0); // Redis 閘門歸零
});
