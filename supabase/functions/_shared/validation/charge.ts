import { z } from "zod";
import { Money, Uuid } from "./base.ts";

export const OrderTipSchema = z
  .object({
    order_id: Uuid,
    tip_amount: Money.max(5000).optional(),
    tip_percentage: z.number().finite().min(0).max(40).optional(),
  })
  .refine(
    (v) => !(v.tip_amount !== undefined && v.tip_percentage !== undefined),
    {
      message: "Set tip_amount OR tip_percentage, not both",
      path: ["tip_amount"],
    },
  );

export type OrderTipInput = z.infer<typeof OrderTipSchema>;
