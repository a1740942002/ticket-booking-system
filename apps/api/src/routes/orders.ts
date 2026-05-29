import { Hono } from "hono";
import { CreateOrderRequest } from "@tickets/shared";
import { db } from "../db";
import { ticketZones, orders } from "../db/schema";
import { eq } from "drizzle-orm";

export const ordersRoute = new Hono();

ordersRoute.post("/", async (c) => {
  const userId = Number(c.req.header("Authorization"));
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const body = CreateOrderRequest.parse(await c.req.json());

  // ⚠️ Phase 1 天真扣庫存:讀 → 改 → 寫（為 Phase 2 超賣鋪路）
  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, body.zoneId));
  if (!zone) return c.json({ error: "zone not found" }, 404);
  if (zone.availableQuantity < body.quantity) {
    return c.json({ error: "insufficient stock" }, 409);
  }
  const newAvailable = zone.availableQuantity - body.quantity;
  await db.update(ticketZones)
    .set({ availableQuantity: newAvailable })
    .where(eq(ticketZones.id, body.zoneId));

  const totalPrice = String(Number(zone.price) * body.quantity);
  const [order] = await db.insert(orders).values({
    userId, zoneId: body.zoneId, quantity: body.quantity,
    totalPrice, status: "pending_payment",
  }).returning();

  return c.json(order);
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

  // mock 付款:success → paid，其餘維持 pending（Phase 4 再做逾時釋放）
  const newStatus = outcome === "success" ? "paid" : "pending_payment";
  const [updated] = await db.update(orders)
    .set({ status: newStatus })
    .where(eq(orders.id, id))
    .returning();
  return c.json(updated);
});
