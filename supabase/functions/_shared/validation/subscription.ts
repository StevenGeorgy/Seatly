import { z } from "zod";
import { BoundedText, NonEmptyText, Uuid } from "./base.ts";

// Most subscription-lifecycle edge fns share a tiny payload: just the
// restaurant_id. Centralized to avoid drift between cancel/pause/resume/
// restart/recover/create-stripe-account/create-account-session.
export const RestaurantIdOnlySchema = z.object({
  restaurant_id: Uuid,
  // create-account-session: optional "mode" switches between onboarding
  // (wizard Step 8) and management (dashboard re-verification) components.
  // Other edge fns sharing this schema ignore the field.
  mode: z.enum(["onboarding", "management"]).optional(),
  // create-account-link: optional origin so Stripe redirects to the right
  // place during local dev (defaults to APP_ORIGIN env in prod). Allow-listed
  // in the handler.
  app_origin: BoundedText(200).optional(),
  // create-account-link: optional path to return to after Stripe onboarding
  // completes. Defaults to `/setup?step=8` (wizard). Dashboard surfaces pass
  // their own page path (e.g. `/dashboard/billing`) so the owner lands back
  // on the page they came from. Allow-listed to relative paths only.
  return_path: BoundedText(500).optional(),
});

export type RestaurantIdOnlyInput = z.infer<typeof RestaurantIdOnlySchema>;

// delete-restaurant lives in restaurant-ops.ts (DeleteRestaurantSchema) to
// share the body shape with other lifecycle code paths.

// Stripe PaymentMethod ids look like `pm_...` — Stripe verifies the id, but we
// at least bound the length + reject empty strings so a malformed client
// payload short-circuits before we hit Stripe.
const StripePaymentMethodId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^pm_[A-Za-z0-9_]+$/, "Invalid payment_method_id format");

export const SaveSubscriptionPaymentMethodSchema = z.object({
  restaurant_id: Uuid,
  payment_method_id: StripePaymentMethodId,
  // Disclosure copy shown to the owner at consent time; persisted to the
  // subscription_consent_log table for CRA-compliant audit. Bound large.
  disclosure_text: NonEmptyText(2000),
  // Referral program (currently disabled in the fn body but accepted for
  // forward-compat). Wider character set than PromoCode because referral
  // codes are auto-generated and we don't want to reject valid ones.
  referral_code: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .regex(/^[A-Z0-9_-]+$/, "Invalid referral_code format")
    .optional()
    .nullable(),
});

export type SaveSubscriptionPaymentMethodInput = z.infer<
  typeof SaveSubscriptionPaymentMethodSchema
>;

export const UpdateSubscriptionPaymentMethodSchema = z.object({
  restaurant_id: Uuid,
  payment_method_id: StripePaymentMethodId,
});

export type UpdateSubscriptionPaymentMethodInput = z.infer<
  typeof UpdateSubscriptionPaymentMethodSchema
>;

// create-subscription is deprecated (returns 410 by default) but still
// validates so the rare ALLOW_LEGACY path stays consistent with the others.
export const CreateSubscriptionSchema = z.object({
  restaurant_id: Uuid,
  payment_method_id: StripePaymentMethodId,
});

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionSchema>;

// create-billing-portal-session also accepts an optional deep-link flow + a
// caller-supplied return_url. We bound the return_url; the existing
// isAllowedReturnUrl helper still gates the hostname allowlist.
export const CreateBillingPortalSessionSchema = z.object({
  restaurant_id: Uuid,
  // Bound length only — the `isAllowedReturnUrl` helper in the fn gates the
  // hostname allowlist and silently falls back to the default URL on a bad
  // value (so we don't reject the whole request on a malformed return_url).
  return_url: BoundedText(2000).optional(),
  flow: z
    .enum(["default", "payment_method_update", "subscription_cancel"])
    .optional(),
});

export type CreateBillingPortalSessionInput = z.infer<
  typeof CreateBillingPortalSessionSchema
>;
