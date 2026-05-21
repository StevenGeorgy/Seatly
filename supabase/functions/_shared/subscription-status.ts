// Shared Stripe subscription-status constants.
//
// Several edge fns + the SubscriptionLifecycleControls component had
// hardcoded `["trialing", "active", "past_due"]` and
// `["trialing", "active", "past_due", "incomplete"]` arrays scattered
// inline. The difference between the two sets is subtle (the latter
// includes `incomplete`, used as a "subscription exists but Stripe is
// still resolving payment" sentinel — important for restart/cancel
// idempotency checks). Centralizing here forces every call site to
// pick deliberately.

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "canceled"
  | "paused";

// "This restaurant has a working subscription right now." Used by UI
// + apply-referral-credit (only credit accounts on a working sub).
export const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> =
  new Set<SubscriptionStatus>(["trialing", "active", "past_due"]);

// "Stripe knows about this sub — don't try to create a duplicate."
// Used by cancel-subscription, restart-subscription, create-subscription
// to gate idempotency.
export const RECOVERABLE_SUBSCRIPTION_STATUSES: ReadonlySet<string> =
  new Set<SubscriptionStatus>([
    "trialing",
    "active",
    "past_due",
    "incomplete",
  ]);
