import {
  pgTable, serial, text, integer, timestamp, numeric,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  venue: text("venue").notNull(),
  eventDate: timestamp("event_date").notNull(),
  status: text("status").notNull().default("on_sale"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ticketZones = pgTable("ticket_zones", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id),
  name: text("name").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  totalQuantity: integer("total_quantity").notNull(),
  availableQuantity: integer("available_quantity").notNull(),
  version: integer("version").notNull().default(0), // 樂觀鎖用（Phase 3）
});

// 指定座位（Phase 6）。每個座位是一列,鎖的粒度 = 單一座位。
export const seats = pgTable("seats", {
  id: serial("id").primaryKey(),
  zoneId: integer("zone_id").notNull().references(() => ticketZones.id),
  label: text("label").notNull(), // 例 "A-3-12"
  status: text("status").notNull().default("available"), // available | held | sold
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  zoneId: integer("zone_id").notNull().references(() => ticketZones.id),
  seatId: integer("seat_id").references(() => seats.id), // 指定座位訂單才有（Phase 6）
  quantity: integer("quantity").notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending_payment"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
