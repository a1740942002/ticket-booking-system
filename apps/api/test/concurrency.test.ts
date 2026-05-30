import { expect, test, beforeAll } from "bun:test";
import { app } from "../src/app";
import { db } from "../src/db";
import { events, ticketZones, orders, users } from "../src/db/schema";
import { eq } from "drizzle-orm";

// Phase 3:三種防超賣解法,在「100 人同時搶 10 張票」下都不應超賣。
// 正確的不變量:售出訂單數 <= 總票數,且 availableQuantity == 總票數 - 售出數 >= 0。

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

// 把票區重設成滿庫存,然後讓 BUYERS 個人同時打 path,回傳統計。
async function hammer(path: string) {
  await db.delete(orders);
  await db.update(ticketZones).set({ availableQuantity: STOCK, version: 0 }).where(eq(ticketZones.id, zoneId));

  const responses = await Promise.all(
    buyerIds.map((uid) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: String(uid) },
        body: JSON.stringify({ zoneId, quantity: 1 }),
      }),
    ),
  );

  const succeeded = responses.filter((r) => r.status === 200).length;
  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, zoneId));
  const placed = await db.select().from(orders).where(eq(orders.zoneId, zoneId));
  return { succeeded, available: zone.availableQuantity, sold: placed.length };
}

function report(name: string, r: { succeeded: number; available: number; sold: number }) {
  console.log(`\n[${name}] 下單成功=${r.succeeded}  實際訂單=${r.sold}  剩餘庫存=${r.available}  (總票=${STOCK})`);
}

function expectNoOversell(r: { available: number; sold: number }) {
  expect(r.sold).toBeLessThanOrEqual(STOCK); // 不超賣
  expect(r.available).toBeGreaterThanOrEqual(0); // 庫存不為負
  expect(r.available).toBe(STOCK - r.sold); // 計數器與實際訂單一致(無 lost update)
}

test("① 原子條件更新:不超賣", async () => {
  const r = await hammer("/orders");
  report("原子更新", r);
  expectNoOversell(r);
  expect(r.sold).toBe(STOCK); // 原子更新應剛好賣完
});

test("② 悲觀鎖 FOR UPDATE:不超賣", async () => {
  const r = await hammer("/orders/lock");
  report("悲觀鎖", r);
  expectNoOversell(r);
  expect(r.sold).toBe(STOCK); // 序列化後應剛好賣完
});

test("③ 樂觀鎖 version + 重試:不超賣", async () => {
  const r = await hammer("/orders/optimistic");
  report("樂觀鎖", r);
  expectNoOversell(r); // 不超賣;高競爭下有可能賣不完(重試耗盡),故不斷言剛好 10
});
