import { z } from "zod";
import { BoundedText, EmailLower, NonEmptyText, Uuid } from "./base.ts";

// get-next-bill-preview / get-restaurant-payment-method — restaurant id only.
export const ObservabilityRestaurantOnlySchema = z.object({
  restaurant_id: Uuid,
});

export type ObservabilityRestaurantOnlyInput = z.infer<
  typeof ObservabilityRestaurantOnlySchema
>;

// list-stripe-invoices: optional limit + cursor. Stripe's list cursor format
// is `in_…` for invoices; we bound the length but don't lock the prefix
// because cursors are server-generated tokens — easier to ignore garbage
// inputs than to maintain a regex per Stripe object type.
export const ListStripeInvoicesSchema = z.object({
  restaurant_id: Uuid,
  limit: z.number().int().min(1).max(50).optional(),
  starting_after: BoundedText(120).optional(),
});

export type ListStripeInvoicesInput = z.infer<
  typeof ListStripeInvoicesSchema
>;

// list-stripe-payouts currently only takes restaurant_id, but accept
// limit/cursor for future expansion in case the UI grows pagination.
export const ListStripePayoutsSchema = z.object({
  restaurant_id: Uuid,
  limit: z.number().int().min(1).max(100).optional(),
  starting_after: BoundedText(120).optional(),
});

export type ListStripePayoutsInput = z.infer<
  typeof ListStripePayoutsSchema
>;

// update-billing-details: nested billing address + tax id objects. Each text
// field is bounded per the SECURITY-HARDENING brief.
const BillingAddressSchema = z.object({
  line1: BoundedText(300).nullish(),
  line2: BoundedText(300).nullish(),
  city: BoundedText(120).nullish(),
  province: BoundedText(80).nullish(),
  postal_code: BoundedText(20).nullish(),
  country: BoundedText(80).nullish(),
});

const TaxIdSchema = z
  .object({
    type: NonEmptyText(50),
    value: NonEmptyText(50),
  })
  .nullable();

export const UpdateBillingDetailsSchema = z.object({
  restaurant_id: Uuid,
  legal_name: BoundedText(200).nullish(),
  billing_email: EmailLower.nullish(),
  address: BillingAddressSchema.nullish(),
  // `null` means clear the tax id; `undefined` means leave unchanged.
  tax_id: TaxIdSchema.optional(),
});

export type UpdateBillingDetailsInput = z.infer<
  typeof UpdateBillingDetailsSchema
>;
