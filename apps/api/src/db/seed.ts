import { db } from "./index";
import { events, ticketZones } from "./schema";

const [event] = await db
  .insert(events)
  .values({
    title: "2026 巨星演唱會",
    venue: "台北小巨蛋",
    eventDate: new Date("2026-12-31T20:00:00Z"),
  })
  .returning();

await db.insert(ticketZones).values([
  { eventId: event.id, name: "搖滾區", price: "4800", totalQuantity: 100, availableQuantity: 100 },
  { eventId: event.id, name: "看台 A", price: "2800", totalQuantity: 200, availableQuantity: 200 },
]);

console.log("Seed done:", event.title);
process.exit(0);
