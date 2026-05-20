// SubscriptionLifecycleControls — state-aware button group on Settings →
// Billing that handles Pause / Cancel / Resume / Restart.
//
// Replaces the previous "Cancel plan" button (which redirected to Stripe
// portal). Reads the existing restaurant row to compute current state.

import { useState } from "react";
import { Loader2, Pause, Play, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CancelSubscriptionModal } from "@/components/billing/CancelSubscriptionModal";
import { PauseSubscriptionModal } from "@/components/billing/PauseSubscriptionModal";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { StaffRestaurantRow } from "@/hooks/useStaffRestaurants";

interface SubscriptionLifecycleControlsProps {
  restaurant: StaffRestaurantRow;
  onStateChanged?: () => void;
}

type LifecycleState =
  | "no_subscription"
  | "active"
  | "cancel_pending"
  | "paused"
  | "ended";

function computeLifecycleState(r: StaffRestaurantRow): LifecycleState {
  if (
    r.subscription_status === "canceled" ||
    r.paused_reason === "subscription_cancelled"
  ) {
    return "ended";
  }
  if (r.subscription_paused_at) return "paused";
  if (r.subscription_cancel_at_period_end) return "cancel_pending";
  if (
    r.subscription_status &&
    ["trialing", "active", "past_due"].includes(r.subscription_status)
  ) {
    return "active";
  }
  return "no_subscription";
}

async function callEdgeFn(
  path: string,
  restaurantId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase not configured" };
  }
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "Sign in required" };
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: getSupabaseAnonKey(),
    },
    body: JSON.stringify({ restaurant_id: restaurantId }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || body?.error) {
    return { ok: false, error: body?.error ?? `Request failed (${res.status})` };
  }
  return { ok: true };
}

export function SubscriptionLifecycleControls({
  restaurant,
  onStateChanged,
}: SubscriptionLifecycleControlsProps) {
  const state = computeLifecycleState(restaurant);
  const [showCancel, setShowCancel] = useState(false);
  const [showPause, setShowPause] = useState(false);
  const [submitting, setSubmitting] = useState<"resume" | "restart" | null>(null);

  async function handleResume() {
    if (submitting) return;
    setSubmitting("resume");
    try {
      const r = await callEdgeFn("resume-subscription", restaurant.id);
      if (r.ok) {
        toast.success("Subscription resumed.");
        onStateChanged?.();
      } else {
        toast.error(r.error ?? "Couldn't resume subscription.");
      }
    } finally {
      setSubmitting(null);
    }
  }

  async function handleRestart() {
    if (submitting) return;
    setSubmitting("restart");
    try {
      const r = await callEdgeFn("restart-subscription", restaurant.id);
      if (r.ok) {
        toast.success("Welcome back! Your restaurant is live again.");
        onStateChanged?.();
      } else {
        toast.error(r.error ?? "Couldn't restart subscription.");
      }
    } finally {
      setSubmitting(null);
    }
  }

  if (state === "no_subscription") return null;

  if (state === "ended") {
    return (
      <div className="inline-flex items-center gap-2">
        <Button
          onClick={() => void handleRestart()}
          disabled={submitting !== null}
          className="gap-1.5 bg-success text-white hover:bg-success/90"
        >
          {submitting === "restart" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          Restart subscription
        </Button>
      </div>
    );
  }

  if (state === "cancel_pending" || state === "paused") {
    return (
      <div className="inline-flex items-center gap-2">
        <Button
          onClick={() => void handleResume()}
          disabled={submitting !== null}
          className="gap-1.5 bg-success text-white hover:bg-success/90"
        >
          {submitting === "resume" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Resume subscription
        </Button>
      </div>
    );
  }

  // state === "active"
  const isTrialing = restaurant.subscription_status === "trialing";
  return (
    <>
      <div className="inline-flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => setShowPause(true)}
          className="gap-1.5"
        >
          <Pause className="size-3.5" />
          Pause
        </Button>
        <Button
          variant="ghost"
          onClick={() => setShowCancel(true)}
          className="gap-1.5 text-text-muted hover:text-danger"
        >
          <XCircle className="size-3.5" />
          Cancel plan
        </Button>
      </div>
      <CancelSubscriptionModal
        restaurantId={restaurant.id}
        open={showCancel}
        onClose={() => setShowCancel(false)}
        onCancelled={onStateChanged}
      />
      <PauseSubscriptionModal
        restaurantId={restaurant.id}
        isTrialing={isTrialing}
        open={showPause}
        onClose={() => setShowPause(false)}
        onPaused={onStateChanged}
      />
    </>
  );
}
