// Shared Stripe Node SDK init.
//
// Every edge fn that uses the Stripe SDK was duplicating the same two
// lines: `await import("npm:stripe@17")` + `new Stripe(key, { apiVersion:
// "2024-11-20.acacia" })`. Centralizing here makes the SDK upgrade a
// one-line change and prevents API-version drift between functions.
//
// NOTE: This is the SDK-init helper. The legacy raw-fetch helper in
// `_shared/stripe.ts` (used by register-restaurant-owner + cenaiva-
// orchestrate) pins its OWN `STRIPE_API_VERSION` constant because those
// callers use direct HTTPS calls, not the npm SDK, and they were
// pinned earlier. Don't conflate the two.

// @ts-nocheck — Deno dynamic-import types resolve at runtime.
import type Stripe from "npm:stripe@17";

export const STRIPE_API_VERSION = "2024-11-20.acacia";

export async function getStripeClient(secretKey: string): Promise<Stripe> {
  const { default: Stripe } = await import("npm:stripe@17");
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}
