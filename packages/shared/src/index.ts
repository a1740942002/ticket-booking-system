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
