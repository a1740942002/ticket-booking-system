import { Hono } from "hono";
import { CreateOrderRequest } from "@tickets/shared";
import { db } from "../db";
import { ticketZones, orders } from "../db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { RESERVATION_MS, expireOrderIfPending } from "../orders/expiry";

export const ordersRoute = new Hono();

// 共用:把訂單寫進 orders 表。exec 可以是 db 或交易 tx。
// 下單即「保留」庫存,並設 expires_at:逾時未付款會被釋放（Phase 4）。
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Zone = typeof ticketZones.$inferSelect;

async function insertOrder(exec: Executor, userId: number, zone: Zone, quantity: number) {
  const totalPrice = String(Number(zone.price) * quantity);
  const expiresAt = new Date(Date.now() + RESERVATION_MS);
  const [order] = await exec
    .insert(orders)
    .values({ userId, zoneId: zone.id, quantity, totalPrice, status: "pending_payment", expiresAt })
    .returning();
  return order;
}

// ① 原子條件更新（預設解法）
// 「檢查庫存 + 扣減」壓進單一 UPDATE,由資料庫保證原子性。
// WHERE 同時擋住庫存不足,並發請求在該列上序列化,不會有 lost update。
ordersRoute.post("/", async (c) => {
  const userId = Number(c.req.header("Authorization"));
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = CreateOrderRequest.parse(await c.req.json());

  const [zone] = await db
    .update(ticketZones)
    .set({ availableQuantity: sql`${ticketZones.availableQuantity} - ${body.quantity}` })
    .where(
      and(
        eq(ticketZones.id, body.zoneId),
        gte(ticketZones.availableQuantity, body.quantity),
      ),
    )
    .returning();

  if (!zone) {
    // 沒更新到任何列:不是票區不存在,就是庫存不足
    const [exists] = await db.select().from(ticketZones).where(eq(ticketZones.id, body.zoneId));
    return exists
      ? c.json({ error: "insufficient stock" }, 409)
      : c.json({ error: "zone not found" }, 404);
  }

  return c.json(await insertOrder(db, userId, zone, body.quantity));
});

// ② 悲觀鎖 SELECT ... FOR UPDATE
// 交易內先鎖住該列,其他交易必須排隊等鎖釋放,因此讀到的值保證最新。
// 仍是「讀→改→寫」,但鎖把並發序列化了,所以安全。代價:鎖競爭、吞吐較低。
ordersRoute.post("/lock", async (c) => {
  const userId = Number(c.req.header("Authorization"));
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = CreateOrderRequest.parse(await c.req.json());

  const result = await db.transaction(async (tx) => {
    const [zone] = await tx
      .select()
      .from(ticketZones)
      .where(eq(ticketZones.id, body.zoneId))
      .for("update");
    if (!zone) return { code: 404 as const, error: "zone not found" };
    if (zone.availableQuantity < body.quantity) {
      return { code: 409 as const, error: "insufficient stock" };
    }
    await tx
      .update(ticketZones)
      .set({ availableQuantity: zone.availableQuantity - body.quantity })
      .where(eq(ticketZones.id, body.zoneId));
    const order = await insertOrder(tx, userId, zone, body.quantity);
    return { code: 200 as const, order };
  });

  if (result.code !== 200) return c.json({ error: result.error }, result.code);
  return c.json(result.order);
});

// ③ 樂觀鎖 version 欄位 + 重試（compare-and-swap）
// 不鎖。讀出 version,寫回時用 WHERE version = 舊值;若沒中代表別人先改了 → 重讀重試。
// 低競爭時最快(無鎖);高競爭時重試成本高,甚至可能重試耗盡。
ordersRoute.post("/optimistic", async (c) => {
  const userId = Number(c.req.header("Authorization"));
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = CreateOrderRequest.parse(await c.req.json());

  const MAX_RETRIES = 20;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, body.zoneId));
    if (!zone) return c.json({ error: "zone not found" }, 404);
    if (zone.availableQuantity < body.quantity) {
      return c.json({ error: "insufficient stock" }, 409);
    }

    const updated = await db
      .update(ticketZones)
      .set({
        availableQuantity: zone.availableQuantity - body.quantity,
        version: zone.version + 1,
      })
      .where(and(eq(ticketZones.id, body.zoneId), eq(ticketZones.version, zone.version)))
      .returning();

    if (updated.length > 0) {
      return c.json(await insertOrder(db, userId, zone, body.quantity));
    }
    // version 對不上 → 有人搶先,重讀重試
  }
  return c.json({ error: "too much contention, please retry" }, 409);
});

ordersRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return c.json({ error: "not found" }, 404);
  return c.json(order);
});

ordersRoute.post("/:id/pay", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const outcome = body.outcome ?? "success"; // success | fail

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return c.json({ error: "not found" }, 404);
  if (order.status !== "pending_payment") {
    return c.json({ error: "order not payable" }, 409);
  }

  // 把關:保留已逾時 → 釋放庫存並拒絕付款（不依賴背景掃描的時機）
  if (order.expiresAt && order.expiresAt.getTime() < Date.now()) {
    await expireOrderIfPending(order);
    return c.json({ error: "reservation expired" }, 409);
  }

  // mock 付款:success → paid,其餘維持 pending
  const newStatus = outcome === "success" ? "paid" : "pending_payment";
  const [updated] = await db
    .update(orders)
    .set({ status: newStatus })
    .where(eq(orders.id, id))
    .returning();
  return c.json(updated);
});
