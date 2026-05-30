import { db } from "./index";
import { events, ticketZones, seats } from "./schema";

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

// 指定座位示範（Phase 6）:一個對號入座的票區 + 一排座位
const [seatedZone] = await db
  .insert(ticketZones)
  .values({ eventId: event.id, name: "對號區", price: "3800", totalQuantity: 10, availableQuantity: 10 })
  .returning();

await db.insert(seats).values(
  Array.from({ length: 10 }, (_, i) => ({ zoneId: seatedZone.id, label: `A-${i + 1}` })),
);

console.log("Seed done:", event.title);
process.exit(0);
