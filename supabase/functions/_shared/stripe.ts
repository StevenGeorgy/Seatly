// @ts-nocheck
// Shared Stripe helpers. Previously two functions hit Stripe with two
// different API versions ("2024-06-20" in register-restaurant-owner,
// "2025-02-24.acacia" in cenaiva-orchestrate); centralizing here makes
// upgrading the API version a one-line change.

export const STRIPE_API_VERSION = "2025-02-24.acacia";

const STRIPE_BASE = "https://api.stripe.com/v1";

function stripeSecret(): string {
  const key = Deno.env.get("STRIPE_SECRET_KEY")?.trim() ?? "";
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY.");
  return key;
}

export async function stripeRequest(
  path: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const form = new URLSearchParams(body);
  const response = await fetch(`${STRIPE_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
    },
    body: form.toString(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Stripe request failed.");
  }
  return data;
}

export async function stripeGet(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${STRIPE_BASE}/${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeSecret()}`,
      "Stripe-Version": STRIPE_API_VERSION,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Stripe request failed.");
  }
  return data;
}
