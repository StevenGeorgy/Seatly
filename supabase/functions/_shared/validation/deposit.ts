import { z } from "zod";
import { BoundedText, EmailLower, NonEmptyText, Uuid } from "./base.ts";

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
  // Optional: if the PI has already been created for the deposit, pass its
  // id so prepare-deposit can stamp `metadata.deposit_payment_ids` on it
  // post-insert. Needed for the inline split-pay flow where the diner pays
  // BEFORE the rows exist (RestaurantPublicPage). Vuln 2 hardening
  // 2026-05-20.
  payment_intent_id: BoundedText(200)
    .regex(/^pi_[A-Za-z0-9_]+$/, "payment_intent_id must start with pi_")
    .optional(),
});

export type PrepareDepositInput = z.infer<typeof PrepareDepositInputSchema>;
