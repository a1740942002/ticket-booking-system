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
