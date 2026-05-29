import { Hono } from "hono";
import { db } from "../db";
import { events, ticketZones } from "../db/schema";
import { eq } from "drizzle-orm";

export const eventsRoute = new Hono();

eventsRoute.get("/", async (c) => {
  const all = await db.select().from(events);
  return c.json(all);
});

eventsRoute.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [event] = await db.select().from(events).where(eq(events.id, id));
  if (!event) return c.json({ error: "not found" }, 404);
  const zones = await db.select().from(ticketZones).where(eq(ticketZones.eventId, id));
  return c.json({ ...event, zones });
});
