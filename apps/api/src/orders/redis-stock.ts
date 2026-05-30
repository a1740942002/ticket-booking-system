import { redis } from "../redis";
import { db } from "../db";
import { ticketZones } from "../db/schema";
import { eq } from "drizzle-orm";

export const stockKey = (zoneId: number) => `stock:zone:${zoneId}`;

// 暖機:把 DB 的 availableQuantity 同步進 Redis(初始化閘門)。
export async function syncZoneStockToRedis(zoneId: number) {
  const [zone] = await db.select().from(ticketZones).where(eq(ticketZones.id, zoneId));
  if (!zone) return;
  await redis.set(stockKey(zoneId), zone.availableQuantity);
}

// 原子預扣(check-and-decrement,單一 Lua 內完成,Redis 單執行緒保證原子)。
// 回傳:新剩餘(>=0)= 成功;-1 = 未初始化;-2 = 庫存不足。
const PRE_DEDUCT = `
local cur = redis.call('GET', KEYS[1])
if cur == false then return -1 end
cur = tonumber(cur)
local qty = tonumber(ARGV[1])
if cur < qty then return -2 end
return redis.call('DECRBY', KEYS[1], qty)
`;
export async function preDeduct(zoneId: number, qty: number): Promise<number> {
  return (await redis.eval(PRE_DEDUCT, 1, stockKey(zoneId), String(qty))) as number;
}

// 把票還回 Redis,只在 key 已存在時(避免替沒初始化的 zone 建錯 key)。
// best-effort:Redis 是閘門/快取,DB 才是真相;還庫存失敗不應讓主流程掛掉。
const RETURN_STOCK = `
if redis.call('EXISTS', KEYS[1]) == 1 then return redis.call('INCRBY', KEYS[1], ARGV[1]) else return -1 end
`;
export async function returnStockToRedis(zoneId: number, qty: number) {
  try {
    await redis.eval(RETURN_STOCK, 1, stockKey(zoneId), String(qty));
  } catch (e) {
    console.warn("[redis] returnStock 失敗(忽略,DB 仍是真相):", (e as Error).message);
  }
}
