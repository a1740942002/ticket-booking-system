import { Hono } from "hono";
import { db } from "../db";
import { seats, ticketZones } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { insertOrder } from "../orders/create";

export const seatsRoute = new Hono();

// 列出某票區的所有座位
seatsRoute.get("/zone/:zoneId", async (c) => {
  const zoneId = Number(c.req.param("zoneId"));
  const list = await db.select().from(seats).where(eq(seats.zoneId, zoneId));
  return c.json(list);
});

// 搶位:鎖的粒度 = 單一座位。
// 原子條件更新佔住座位(available → held,同一座位只有一人能成功),再建立保留訂單。
seatsRoute.post("/:id/claim", async (c) => {
  const userId = Number(c.req.header("Authorization"));
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const seatId = Number(c.req.param("id"));

  const [seat] = await db
    .update(seats)
    .set({ status: "held" })
    .where(and(eq(seats.id, seatId), eq(seats.status, "available")))
    .returning();

  if (!seat) {
    const [exists] = await db.select().from(seats).where(eq(seats.id, seatId));
    return exists
      ? c.json({ error: "seat unavailable" }, 409) // 已被別人搶走
      : c.json({ error: "seat not found" }, 404);
  }

  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, seat.zoneId));
  const order = await insertOrder(db, userId, zone, 1, seat.id);
  return c.json(order);
});
