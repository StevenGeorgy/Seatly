import { z } from "zod";
import { EmailLower, NonEmptyText, Uuid } from "./base.ts";

export const DepositPayerSchema = z
  .object({
    user_profile_id: Uuid.optional(),
    full_name: NonEmptyText(120).optional(),
    email: EmailLower.optional(),
    amount_cents: z.number().int().nonnegative().max(10_000_000),
  })
  .refine((p) => p.email !== undefined || p.user_profile_id !== undefined, {
    message: "Each payer needs an email or user_profile_id",
    path: ["email"],
  });

export type DepositPayer = z.infer<typeof DepositPayerSchema>;

export const PrepareDepositInputSchema = z.object({
  reservation_id: Uuid,
  payers: z.array(DepositPayerSchema).min(1).max(50),
});

export type PrepareDepositInput = z.infer<typeof PrepareDepositInputSchema>;
