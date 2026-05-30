import Redis from "ioredis";

// lazyConnect:import 時不連線,第一個指令才連 → 不用 Redis 的測試不受影響。
export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});
