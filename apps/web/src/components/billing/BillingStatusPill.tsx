// BillingStatusPill — small chip in the dashboard header that surfaces
// subscription / trial / billing health at a glance. Green when fine,
// amber for soft warnings (trial ending soon, past due), and renders
// NOTHING when the restaurant is in a hard payment-failed state because
// the existing `PaymentFailedBanner` already takes over the full top of
// the dashboard for that case.
//
// Reads existing restaurant fields (subscription_status, trial_ends_at,
// paused_reason) from the row that's already loaded by useStaffRestaurants
// — no new fetch.

import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

interface BillingStatusPillProps {
  subscriptionStatus: string | null | undefined;
  trialEndsAt: string | null | undefined;
  pausedReason: string | null | undefined;
  /** Mirrors Stripe sub.cancel_at_period_end — when true, render "Cancelling on {date}". */
  cancelAtPeriodEnd?: boolean | null;
  /** When set, sub is paused via Stripe pause_collection. */
  pausedAt?: string | null;
  className?: string;
}

type Tone = "green" | "amber" | "hidden";

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffMs = t - Date.now();
  return Math.ceil(diffMs / 86_400_000);
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function computeState(
  subscriptionStatus: string | null | undefined,
  trialEndsAt: string | null | undefined,
  pausedReason: string | null | undefined,
  cancelAtPeriodEnd: boolean | null | undefined,
  pausedAt: string | null | undefined,
): { tone: Tone; copy: string } {
  // Hard payment-failed state → render NOTHING (PaymentFailedBanner shows
  // the full red banner instead).
  if (pausedReason === "payment_failed") {
    return { tone: "hidden", copy: "" };
  }
  // Pending deletion → also handled by RestoreRestaurantBanner.
  if (pausedReason === "pending_deletion") {
    return { tone: "hidden", copy: "" };
  }
  // Fully cancelled, post-period — terminal state until owner Restarts.
  if (pausedReason === "subscription_cancelled" || subscriptionStatus === "canceled") {
    return { tone: "amber", copy: "Subscription ended · Restart →" };
  }
  // Paused via Stripe pause_collection → owner clicked Pause.
  if (pausedAt) {
    return { tone: "amber", copy: "Subscription paused · Resume →" };
  }
  // Cancel pending — owner clicked Cancel, sub still active until period end.
  if (cancelAtPeriodEnd) {
    return {
      tone: "amber",
      copy: trialEndsAt
        ? `Cancelling on ${formatShortDate(trialEndsAt)}`
        : "Cancelling soon · Resume →",
    };
  }

  const daysLeft = daysUntil(trialEndsAt);

  switch (subscriptionStatus) {
    case "trialing":
      if (daysLeft !== null && daysLeft <= 14) {
        return {
          tone: "amber",
          copy: `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        };
      }
      return {
        tone: "green",
        copy: trialEndsAt
          ? `Trial active · Free until ${formatShortDate(trialEndsAt)}`
          : "Trial active",
      };
    case "active":
      return { tone: "green", copy: "Billing active" };
    case "past_due":
      return { tone: "amber", copy: "Last bill past due" };
    case "unpaid":
      return { tone: "amber", copy: "Bill unpaid" };
    case "incomplete":
    case "incomplete_expired":
      return { tone: "amber", copy: "Setup incomplete" };
    case "paused":
      return { tone: "amber", copy: "Subscription paused" };
    default:
      // Nothing yet — restaurant probably hasn't published. Don't show
      // the pill at all in that case.
      return { tone: "hidden", copy: "" };
  }
}

export function BillingStatusPill({
  subscriptionStatus,
  trialEndsAt,
  pausedReason,
  cancelAtPeriodEnd,
  pausedAt,
  className,
}: BillingStatusPillProps) {
  const { tone, copy } = computeState(
    subscriptionStatus,
    trialEndsAt,
    pausedReason,
    cancelAtPeriodEnd,
    pausedAt,
  );
  if (tone === "hidden") return null;

  const toneClasses =
    tone === "green"
      ? "border-success/30 bg-success/10 text-success"
      : "border-warning/30 bg-warning/10 text-warning";
  const dotClasses =
    tone === "green" ? "bg-success" : "bg-warning";

  return (
    <Link
      to="/dashboard/settings"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80 ${toneClasses} ${className ?? ""}`}
      aria-label={`Billing status: ${copy}. Tap for details.`}
    >
      <span className={`size-1.5 rounded-full ${dotClasses}`} aria-hidden />
      <span className="whitespace-nowrap">{copy}</span>
      <ChevronRight className="size-3 opacity-60" aria-hidden />
    </Link>
  );
}
