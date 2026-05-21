// Client mirror of supabase/functions/_shared/subscription-status.ts.
//
// Keep in lock-step with the edge fn version. The two files exist
// because edge fns run on Deno (npm:* imports) and the web client
// can't share the same module path.

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "canceled"
  | "paused";

export const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> =
  new Set<SubscriptionStatus>(["trialing", "active", "past_due"]);

export const RECOVERABLE_SUBSCRIPTION_STATUSES: ReadonlySet<string> =
  new Set<SubscriptionStatus>([
    "trialing",
    "active",
    "past_due",
    "incomplete",
  ]);
