# Phase 1 — 核心流程 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好 bun monorepo 地基，做出「瀏覽活動 → 下單（天真扣庫存）→ mock 付款 → 出票」的完整可運作流程，單人操作完全正確。

**Architecture:** bun workspaces 切成 `apps/web`（Vite+React）、`apps/api`（Hono+drizzle）、`packages/shared`（zod 共用型別）。PostgreSQL 跑在 docker compose。Phase 1 的下單刻意用「讀-改-寫」天真扣庫存，為 Phase 2 見證超賣鋪路。

**Tech Stack:** TypeScript, bun, Hono, drizzle ORM, PostgreSQL, zod, Vite, React, TailwindCSS, shadcn/ui, docker compose

---

## File Structure

```
ticket-booking-system/
├── package.json                       # workspaces 根
├── tsconfig.base.json                 # 共用 tsconfig
├── docker-compose.yml                 # postgres
├── .env / .env.example                # DATABASE_URL
├── packages/shared/
│   ├── package.json
│   └── src/index.ts                   # zod schema + 型別
├── apps/api/
│   ├── package.json
│   ├── drizzle.config.ts
│   ├── src/
│   │   ├── db/schema.ts               # drizzle 資料表
│   │   ├── db/index.ts                # 連線
│   │   ├── db/seed.ts                  # 種子資料
│   │   ├── routes/auth.ts
│   │   ├── routes/events.ts
│   │   ├── routes/orders.ts
│   │   ├── app.ts                     # Hono app 組裝（可測試）
│   │   └── index.ts                   # server 進入點
│   └── test/orders.test.ts
└── apps/web/
    ├── package.json
    ├── (vite + tailwind + shadcn 設定)
    └── src/
        ├── lib/api.ts                 # API client
        ├── pages/EventsPage.tsx
        ├── pages/EventDetailPage.tsx
        ├── pages/OrderPage.tsx
        └── App.tsx
```

---

## Task 1: Monorepo 骨架

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`(已存在則沿用), `.env.example`

- [ ] **Step 1: 建立根 package.json（bun workspaces）**

```json
{
  "name": "ticket-booking-system",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "db:up": "docker compose up -d",
    "db:down": "docker compose down"
  }
}
```

- [ ] **Step 2: 建立共用 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 3: 建立 .env.example**

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets
```

- [ ] **Step 4: 複製成 .env**

Run: `cp .env.example .env`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: 初始化 bun monorepo 骨架"
```

---

## Task 2: docker compose 啟動 PostgreSQL

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: 撰寫 docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: tickets
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

> 註:Redis 於 Phase 5 再加入此檔，現在不需要。

- [ ] **Step 2: 啟動並驗證**

Run: `docker compose up -d && docker compose ps`
Expected: postgres 服務狀態為 running/healthy。

- [ ] **Step 3: 確認可連線**

Run: `docker compose exec postgres pg_isready -U postgres`
Expected: `accepting connections`

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml && git commit -m "chore: 加入 postgres docker compose"
```

---

## Task 3: packages/shared 共用 zod schema

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/src/index.ts`

- [ ] **Step 1: 建立 packages/shared/package.json**

```json
{
  "name": "@tickets/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.23.8" }
}
```

- [ ] **Step 2: 撰寫共用 schema 與型別**

`packages/shared/src/index.ts`:
```ts
import { z } from "zod";

export const LoginRequest = z.object({ username: z.string().min(1) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const CreateOrderRequest = z.object({
  zoneId: z.number().int().positive(),
  quantity: z.number().int().positive(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

export const OrderStatus = z.enum([
  "pending_payment",
  "paid",
  "expired",
  "cancelled",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;
```

- [ ] **Step 3: 安裝依賴並驗證型別**

Run: `bun install`
Expected: 安裝成功，無錯誤。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(shared): 加入共用 zod schema"
```

---

## Task 4: apps/api drizzle 資料表 schema

**Files:**
- Create: `apps/api/package.json`, `apps/api/drizzle.config.ts`, `apps/api/src/db/schema.ts`

- [ ] **Step 1: 建立 apps/api/package.json**

```json
{
  "name": "@tickets/api",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "bun run src/db/seed.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@tickets/shared": "workspace:*",
    "hono": "^4.6.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0"
  }
}
```

- [ ] **Step 2: 撰寫 drizzle schema**

`apps/api/src/db/schema.ts`:
```ts
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
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  zoneId: integer("zone_id").notNull().references(() => ticketZones.id),
  quantity: integer("quantity").notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending_payment"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

- [ ] **Step 3: 撰寫 drizzle.config.ts**

`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: 安裝依賴**

Run: `bun install`
Expected: 安裝成功。

- [ ] **Step 5: 產生並套用 migration**

Run: `cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun run db:generate && DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun run db:migrate`
Expected: 在 `apps/api/drizzle/` 產生 SQL，並成功套用到資料庫。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): 加入 drizzle schema 與 migration"
```

---

## Task 5: DB 連線與種子資料

**Files:**
- Create: `apps/api/src/db/index.ts`, `apps/api/src/db/seed.ts`

- [ ] **Step 1: 撰寫 DB 連線**

`apps/api/src/db/index.ts`:
```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
```

- [ ] **Step 2: 撰寫種子資料**

`apps/api/src/db/seed.ts`:
```ts
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
```

- [ ] **Step 3: 執行種子**

Run: `cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun run db:seed`
Expected: 印出 `Seed done: 2026 巨星演唱會`。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(api): 加入 DB 連線與種子資料"
```

---

## Task 6: Hono app 組裝 + auth 與 events 路由

**Files:**
- Create: `apps/api/src/app.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/events.ts`, `apps/api/src/index.ts`

- [ ] **Step 1: 撰寫 auth 路由（簡化登入）**

`apps/api/src/routes/auth.ts`:
```ts
import { Hono } from "hono";
import { LoginRequest } from "@tickets/shared";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

export const auth = new Hono();

auth.post("/login", async (c) => {
  const body = LoginRequest.parse(await c.req.json());
  let [user] = await db.select().from(users).where(eq(users.username, body.username));
  if (!user) {
    [user] = await db.insert(users).values({ username: body.username }).returning();
  }
  // 簡化版 token:直接用 userId 當 token
  return c.json({ token: String(user.id), userId: user.id, username: user.username });
});
```

- [ ] **Step 2: 撰寫 events 路由**

`apps/api/src/routes/events.ts`:
```ts
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
```

- [ ] **Step 3: 撰寫 app.ts（組裝，方便測試）**

`apps/api/src/app.ts`:
```ts
import { Hono } from "hono";
import { auth } from "./routes/auth";
import { eventsRoute } from "./routes/events";

export const app = new Hono();
app.route("/auth", auth);
app.route("/events", eventsRoute);
```

- [ ] **Step 4: 撰寫 server 進入點**

`apps/api/src/index.ts`:
```ts
import { app } from "./app";

export default { port: 3000, fetch: app.fetch };
```

- [ ] **Step 5: 啟動並驗證 events API**

Run: `cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun run dev`
然後另開終端:`curl http://localhost:3000/events`
Expected: 回傳含「2026 巨星演唱會」的 JSON 陣列。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): 加入 auth 與 events 路由"
```

---

## Task 7: orders 路由 — 天真扣庫存（TDD）

> 這是 Phase 1 的核心。**刻意**用「讀-改-寫」三步驟扣庫存，單人正確、但為 Phase 2 的超賣鋪路。先寫測試確立單人正確行為。

**Files:**
- Create: `apps/api/src/routes/orders.ts`, `apps/api/test/orders.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: 撰寫失敗測試（單人下單成功且庫存正確扣減）**

`apps/api/test/orders.test.ts`:
```ts
import { expect, test, beforeAll } from "bun:test";
import { app } from "../src/app";
import { db } from "../src/db";
import { events, ticketZones, orders, users } from "../src/db/schema";
import { eq } from "drizzle-orm";

let zoneId: number;
let userId: number;

beforeAll(async () => {
  // 清空並建立乾淨測試資料
  await db.delete(orders);
  await db.delete(ticketZones);
  await db.delete(events);
  await db.delete(users);
  const [u] = await db.insert(users).values({ username: "tester" }).returning();
  userId = u.id;
  const [e] = await db.insert(events).values({
    title: "測試演唱會", venue: "場館", eventDate: new Date("2026-12-31T20:00:00Z"),
  }).returning();
  const [z] = await db.insert(ticketZones).values({
    eventId: e.id, name: "區A", price: "1000", totalQuantity: 10, availableQuantity: 10,
  }).returning();
  zoneId = z.id;
});

test("下單成功並正確扣減庫存", async () => {
  const res = await app.request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ zoneId, quantity: 2 }),
  });
  expect(res.status).toBe(200);
  const order = await res.json();
  expect(order.status).toBe("pending_payment"); // 下單後待付款；付款於 Task 8 處理

  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, zoneId));
  expect(zone.availableQuantity).toBe(8);
});

test("庫存不足時下單失敗", async () => {
  const res = await app.request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ zoneId, quantity: 999 }),
  });
  expect(res.status).toBe(409);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun test`
Expected: FAIL（`/orders` 路由尚不存在，404）。

- [ ] **Step 3: 撰寫 orders 路由（天真扣庫存）**

`apps/api/src/routes/orders.ts`:
```ts
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
```

- [ ] **Step 4: 在 app.ts 掛上 orders 路由**

`apps/api/src/app.ts` 修改為:
```ts
import { Hono } from "hono";
import { auth } from "./routes/auth";
import { eventsRoute } from "./routes/events";
import { ordersRoute } from "./routes/orders";

export const app = new Hono();
app.route("/auth", auth);
app.route("/events", eventsRoute);
app.route("/orders", ordersRoute);
```

- [ ] **Step 5: 執行測試確認通過**

Run: `cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun test`
Expected: PASS（2 個測試通過）。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): 加入 orders 路由（天真扣庫存）"
```

---

## Task 8: mock 付款端點（TDD）

**Files:**
- Modify: `apps/api/src/routes/orders.ts`, `apps/api/test/orders.test.ts`

- [ ] **Step 1: 加上付款測試**

在 `apps/api/test/orders.test.ts` 末尾新增:
```ts
test("付款後訂單變為 paid", async () => {
  const createRes = await app.request("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ zoneId, quantity: 1 }),
  });
  const order = await createRes.json();

  const payRes = await app.request(`/orders/${order.id}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(userId) },
    body: JSON.stringify({ outcome: "success" }),
  });
  expect(payRes.status).toBe(200);
  const paid = await payRes.json();
  expect(paid.status).toBe("paid");
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun test`
Expected: FAIL（`/orders/:id/pay` 不存在）。

- [ ] **Step 3: 加上付款端點**

在 `apps/api/src/routes/orders.ts` 末尾（`export` 後的路由區）新增:
```ts
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
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd apps/api && DATABASE_URL=postgres://postgres:postgres@localhost:5432/tickets bun test`
Expected: PASS（3 個測試通過）。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): 加入 mock 付款端點"
```

---

## Task 9: apps/web — Vite + React + Tailwind + shadcn 骨架

**Files:**
- Create: `apps/web/*`（由 Vite scaffold 產生）

- [ ] **Step 1: 用 Vite 建立 React+TS 專案**

Run: `cd apps && bun create vite@latest web -- --template react-ts`
Expected: 在 `apps/web` 產生 Vite React 專案。

- [ ] **Step 2: 修改 apps/web/package.json 的 name 與安裝依賴**

將 `apps/web/package.json` 的 `"name"` 改為 `"@tickets/web"`，並加入 shared 依賴:
```json
  "dependencies": {
    "@tickets/shared": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  }
```
Run: `cd /Users/brianlai/code/dev/ticket-booking-system && bun install`

- [ ] **Step 3: 安裝並設定 Tailwind**

Run: `cd apps/web && bun add -d tailwindcss postcss autoprefixer && bunx tailwindcss init -p`
然後設定 `apps/web/tailwind.config.js` 的 content:
```js
content: ["./index.html", "./src/**/*.{ts,tsx}"],
```
並在 `apps/web/src/index.css` 最上方加入:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: 設定 path alias（shadcn 需要 @/）**

`apps/web/vite.config.ts` 加入 resolve alias:
```ts
import path from "path";
// 在 defineConfig 內:
resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
```
`apps/web/tsconfig.json` 的 compilerOptions 加入:
```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

- [ ] **Step 5: 初始化 shadcn/ui**

Run: `cd apps/web && bunx shadcn@latest init -d`
Expected: 產生 `components.json` 與 `src/lib/utils.ts`。

- [ ] **Step 6: 加入需要的 shadcn 元件**

Run: `cd apps/web && bunx shadcn@latest add button card input`
Expected: 在 `src/components/ui/` 產生對應元件。

- [ ] **Step 7: 驗證可啟動**

Run: `cd apps/web && bun run dev`
Expected: Vite dev server 啟動，瀏覽器可開啟預設頁。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore(web): 建立 Vite+React+Tailwind+shadcn 骨架"
```

---

## Task 10: apps/web — API client 與頁面

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/pages/EventsPage.tsx`, `apps/web/src/pages/EventDetailPage.tsx`, `apps/web/src/pages/OrderPage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/main.tsx`

- [ ] **Step 1: 設定 Vite proxy 轉發 API**

`apps/web/vite.config.ts` 的 defineConfig 內加入:
```ts
server: {
  proxy: { "/api": { target: "http://localhost:3000", rewrite: (p) => p.replace(/^\/api/, "") } },
},
```

- [ ] **Step 2: 撰寫 API client**

`apps/web/src/lib/api.ts`:
```ts
const TOKEN_KEY = "token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export async function login(username: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  return data;
}

export async function getEvents() {
  return (await fetch("/api/events")).json();
}

export async function getEvent(id: number) {
  return (await fetch(`/api/events/${id}`)).json();
}

export async function createOrder(zoneId: number, quantity: number) {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: getToken() },
    body: JSON.stringify({ zoneId, quantity }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function payOrder(orderId: number) {
  const res = await fetch(`/api/orders/${orderId}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: getToken() },
    body: JSON.stringify({ outcome: "success" }),
  });
  return res.json();
}
```

- [ ] **Step 3: 撰寫活動列表頁**

`apps/web/src/pages/EventsPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getEvents } from "@/lib/api";
import { Card } from "@/components/ui/card";

export function EventsPage() {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => { getEvents().then(setEvents); }, []);
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">演唱會列表</h1>
      {events.map((e) => (
        <Link key={e.id} to={`/events/${e.id}`}>
          <Card className="p-4 hover:bg-accent">
            <div className="font-semibold">{e.title}</div>
            <div className="text-sm text-muted-foreground">{e.venue}</div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 撰寫活動詳情 + 下單頁**

`apps/web/src/pages/EventDetailPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getEvent, createOrder, login, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [username, setUsername] = useState("");

  useEffect(() => { getEvent(Number(id)).then(setEvent); }, [id]);
  if (!event) return <div className="p-6">載入中...</div>;

  async function buy(zoneId: number) {
    if (!getToken()) {
      if (!username) return alert("請先輸入使用者名稱");
      await login(username);
    }
    try {
      const order = await createOrder(zoneId, 1);
      navigate(`/orders/${order.id}`);
    } catch (e: any) {
      alert("下單失敗:" + e.message);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">{event.title}</h1>
      <div className="text-muted-foreground">{event.venue}</div>
      <Input placeholder="使用者名稱" value={username}
        onChange={(e) => setUsername(e.target.value)} />
      {event.zones.map((z: any) => (
        <Card key={z.id} className="p-4 flex justify-between items-center">
          <div>
            <div className="font-semibold">{z.name}</div>
            <div className="text-sm">NT${z.price} ・ 剩 {z.availableQuantity}</div>
          </div>
          <Button disabled={z.availableQuantity < 1} onClick={() => buy(z.id)}>
            搶票
          </Button>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: 撰寫訂單狀態 + 付款頁**

`apps/web/src/pages/OrderPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { payOrder } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function OrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<any>(null);

  async function refresh() {
    const res = await fetch(`/api/orders/${id}`);
    setOrder(await res.json());
  }
  useEffect(() => { refresh(); }, [id]);
  if (!order) return <div className="p-6">載入中...</div>;

  async function pay() {
    await payOrder(Number(id));
    refresh();
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <Card className="p-6 space-y-2">
        <div>訂單 #{order.id}</div>
        <div>數量:{order.quantity}</div>
        <div>金額:NT${order.totalPrice}</div>
        <div>狀態:<span className="font-bold">{order.status}</span></div>
        {order.status === "pending_payment" && (
          <Button onClick={pay}>確認付款（mock）</Button>
        )}
        {order.status === "paid" && <div className="text-green-600">✅ 出票成功</div>}
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: 設定路由**

`apps/web/src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { EventsPage } from "@/pages/EventsPage";
import { EventDetailPage } from "@/pages/EventDetailPage";
import { OrderPage } from "@/pages/OrderPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/orders/:id" element={<OrderPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 7: 手動驗證完整流程（end-to-end）**

前置:`docker compose up -d`、API `bun run dev`（apps/api）、Web `bun run dev`（apps/web）皆啟動。
操作:開首頁 → 點活動 → 輸入名稱 → 搶票 → 在訂單頁按付款 → 看到「出票成功」。
回頭重整活動詳情，確認該區剩餘數量已減少。
Expected: 整個流程順暢，庫存數字正確。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(web): 加入活動列表、下單、付款頁面"
```

---

## 完成標準（Phase 1 Definition of Done）

- [ ] `docker compose up -d` 啟動 postgres，migration 與 seed 成功
- [ ] `bun test`（apps/api）全綠
- [ ] 前端可走完「瀏覽 → 搶票 → 付款 → 出票」流程
- [ ] 單人操作下，庫存扣減完全正確
- [ ] orders 路由刻意保留「讀-改-寫」天真扣庫存，為 Phase 2 見證超賣鋪路

完成後即進入 Phase 2:撰寫併發測試腳本，親眼見證超賣。
