// PayoutsSection — shows the restaurant's Stripe Connect payouts: pending
// balance + recent payout history with bank-arrival dates. Powered by
// list-stripe-payouts edge fn (calls stripe.payouts.list + balance.retrieve
// on the connected account).
//
// Helpful for restaurants who see diners pay but wonder "where's the money
// in my bank?" — the answer is Stripe's 2-7 day rolling payout schedule.

import { useEffect, useState } from "react";
import { AlertTriangle, CreditCard, Landmark, Loader2, RefreshCw, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { invokeEdgeFunction } from "@/lib/supabase/edge-fn";
import { isSafeStripeConnectUrl } from "@/lib/auth/post-login-redirect";
import { toUserFacingError } from "@/lib/errors";

// Hosted Account Link button. Replaces the embedded Stripe Connect panel
// previously rendered here. Clicking opens connect.stripe.com hosted
// onboarding for the connected account; when Stripe is done the owner
// lands back on THIS dashboard page (not the wizard) via the `return_path`
// param sent to the create-account-link edge fn.
function StripeHostedDashboardButton({
  restaurantId,
  onPollNeeded,
  ctaLabel,
  linkType,
  variant,
}: {
  restaurantId: string;
  onPollNeeded: () => void;
  ctaLabel: string;
  linkType?: "onboarding" | "update";
  variant?: "default" | "ghost" | "outline";
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If Stripe redirected us back to this page (`?stripe=return` or
  // `?stripe=refresh`), fire the poll callback so the panel re-fetches
  // the payouts payload. Strip the query params so a manual refresh
  // doesn't re-trigger.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const stripeFlag = url.searchParams.get("stripe");
    if (stripeFlag === "return" || stripeFlag === "refresh") {
      url.searchParams.delete("stripe");
      url.searchParams.delete("restaurant_id");
      window.history.replaceState({}, "", url.toString());
      onPollNeeded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const acctRes = await invokeEdgeFunction<{ account_id: string }>(
        "create-stripe-account",
        { restaurant_id: restaurantId },
      );
      if (!acctRes.ok) throw new Error(acctRes.error);
      const currentPath =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/dashboard";
      const linkRes = await invokeEdgeFunction<{ url: string }>(
        "create-account-link",
        {
          restaurant_id: restaurantId,
          app_origin: typeof window !== "undefined" ? window.location.origin : undefined,
          return_path: currentPath,
          link_type: linkType ?? "onboarding",
        },
      );
      if (!linkRes.ok) throw new Error(linkRes.error);
      if (!linkRes.data?.url) {
        throw new Error("Stripe didn't return an onboarding URL. Try again.");
      }
      // Defense-in-depth: only navigate if the URL is actually a Stripe
      // Connect host. Stripe-issued URLs always are; the check protects
      // against a compromised edge fn or unexpected response sending
      // the authenticated browser to an arbitrary destination.
      if (!isSafeStripeConnectUrl(linkRes.data.url)) {
        throw new Error("Got an unexpected onboarding URL from Stripe. Try again.");
      }
      window.location.href = linkRes.data.url;
    } catch (err) {
      const friendly = toUserFacingError(err, "Couldn't open Stripe.");
      setError(friendly.message);
      console.error("[PayoutsSection.hosted]", friendly.code, friendly.technical ?? err);
      setLoading(false);
    }
  };

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant={variant ?? "default"}
        className="gap-2"
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Opening Stripe…
          </>
        ) : (
          <>
            <CreditCard className="size-4" /> {ctaLabel}
          </>
        )}
      </Button>
    </div>
  );
}

interface PayoutsSectionProps {
  restaurantId: string;
  className?: string;
}

interface PayoutRow {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  arrival_date_iso: string | null;
  created_iso: string | null;
}

interface PayoutsResponse {
  ok: boolean;
  has_account: boolean;
  payouts_enabled: boolean;
  // Added 2026-05-23: fields needed to distinguish "Stripe verifying"
  // (no user action) from "action required" (button + banner).
  // `requirements_due`: Stripe's `currently_due` or `past_due` arrays are
  // non-empty (excluding items already in `pending_verification`), OR
  // `disabled_reason` is set to something other than `pending_verification.*`.
  // `requirements_processing`: items in `pending_verification` AND nothing
  // actionable — Stripe is processing the owner's last submission.
  charges_enabled?: boolean;
  details_submitted?: boolean;
  requirements_due?: boolean;
  requirements_processing?: boolean;
  available_balance_cents: number;
  pending_balance_cents: number;
  payouts: PayoutRow[];
  stripe_error?: string;
}

function formatMoney(cents: number, currency: string): string {
  const value = cents / 100;
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).format(value);
  } catch {
    return `${currency.toUpperCase()} $${value.toFixed(2)}`;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusLabel(s: string): { text: string; tone: "green" | "amber" | "muted" | "danger" } {
  switch (s) {
    case "paid":
      return { text: "Paid", tone: "green" };
    case "in_transit":
      return { text: "In transit", tone: "amber" };
    case "pending":
      return { text: "Pending", tone: "amber" };
    case "failed":
      return { text: "Failed", tone: "danger" };
    case "canceled":
      return { text: "Cancelled", tone: "muted" };
    default:
      return { text: s, tone: "muted" };
  }
}

export function PayoutsSection({ restaurantId, className }: PayoutsSectionProps) {
  const [data, setData] = useState<PayoutsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Bump this to force a re-fetch (e.g. after Stripe verification UI closes).
  const [refreshKey, setRefreshKey] = useState(0);
  const handleStripeReturnPoll = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      if (!isSupabaseConfigured()) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const client = getSupabaseBrowserClient();
        const { data: sessionData } = await client.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          if (!cancelled) setLoading(false);
          return;
        }
        const res = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/list-stripe-payouts`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              apikey: getSupabaseAnonKey(),
            },
            body: JSON.stringify({ restaurant_id: restaurantId }),
          },
        );
        const body = (await res.json().catch(() => null)) as PayoutsResponse | null;
        if (cancelled) return;
        if (res.ok && body) setData(body);
        setLoading(false);
      } catch (err) {
        console.warn("[PayoutsSection.load] failed", err);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, refreshKey]);

  if (loading) {
    return (
      <div className={`rounded-xl border border-border bg-bg-surface/40 px-4 py-3 ${className ?? ""}`}>
        <p className="text-sm text-text-muted">Loading payouts…</p>
      </div>
    );
  }

  if (!data || !data.has_account) {
    return (
      <div className={`rounded-xl border border-border bg-bg-surface/40 ${className ?? ""}`}>
        <div className="border-b border-border px-4 py-3">
          <h4 className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Landmark className="size-4 text-text-muted" /> Payouts
          </h4>
          <p className="mt-1 text-sm text-text-muted">
            Connect Stripe to start receiving payouts to your bank. We use
            Stripe's hosted onboarding — your identity + bank details never
            touch Cenaiva.
          </p>
        </div>
        <div className="p-4">
          <StripeHostedDashboardButton
            restaurantId={restaurantId}
            ctaLabel="Continue with Stripe"
            onPollNeeded={handleStripeReturnPoll}
          />
        </div>
      </div>
    );
  }

  const payouts = data.payouts ?? [];
  const currency = payouts[0]?.currency ?? "cad";

  return (
    <div className={`rounded-xl border border-border bg-bg-surface/40 ${className ?? ""}`}>
      <div className="border-b border-border px-4 py-3">
        <h4 className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Landmark className="size-4 text-text-muted" /> Payouts to your bank
        </h4>
        <p className="mt-1 text-xs text-text-muted">
          Stripe holds funds for 2–7 days, then transfers to your bank automatically.
        </p>
      </div>

      {data.stripe_error ? (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-warning/5 px-4 py-2.5 text-xs">
          <span className="flex items-center gap-2 text-warning">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            Could not reach Stripe right now. Showing cached data.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="size-3" />
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 border-b border-border px-4 py-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">Available now</div>
          <div className="mt-1 font-semibold text-text-primary">
            {formatMoney(data.available_balance_cents, currency)}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">Pending</div>
          <div className="mt-1 font-semibold text-text-primary">
            {formatMoney(data.pending_balance_cents, currency)}
          </div>
        </div>
      </div>

      {(() => {
        // Three states, deterministic, trust whatever Stripe reports now:
        //   verified       → payouts_enabled = render the "Update banking
        //                    info" CTA only (no scary banners)
        //   actionRequired → requirements_due OR !details_submitted →
        //                    yellow banner + "Update on Stripe" button
        //   processing     → otherwise → blue banner, NO button
        if (data.payouts_enabled) {
          return (
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs">
              <p className="text-text-secondary">
                Want to change the bank account that receives your payouts?
              </p>
              <StripeHostedDashboardButton
                restaurantId={restaurantId}
                ctaLabel="Update banking info"
                onPollNeeded={handleStripeReturnPoll}
                linkType="update"
                variant="outline"
              />
            </div>
          );
        }

        const requirementsDue = Boolean(data.requirements_due);
        const detailsSubmitted = Boolean(data.details_submitted);
        const needsAction = !detailsSubmitted || requirementsDue;

        if (needsAction) {
          return (
            <>
              <div className="space-y-1 border-b border-border bg-warning/5 px-4 py-3 text-xs text-warning">
                <p className="font-semibold">
                  {detailsSubmitted
                    ? "Stripe needs something from you"
                    : "Finish your Stripe setup"}
                </p>
                <p className="text-text-secondary">
                  {detailsSubmitted
                    ? "Payouts to your bank are paused until you finish a step on Stripe. Click below to open Stripe's hosted page, fix the outstanding item, and you'll land back here automatically."
                    : "You haven't completed Stripe verification yet. Click below to finish — takes about 2 minutes."}
                </p>
              </div>
              <div className="border-b border-border p-4">
                <StripeHostedDashboardButton
                  restaurantId={restaurantId}
                  ctaLabel={detailsSubmitted ? "Update on Stripe" : "Continue with Stripe"}
                  onPollNeeded={handleStripeReturnPoll}
                />
              </div>
            </>
          );
        }

        return (
          <div className="space-y-1 border-b border-border bg-sky-500/5 px-4 py-3 text-xs text-sky-300">
            <p className="font-semibold">Stripe is verifying your account</p>
            <p className="text-text-secondary">
              You've submitted everything Stripe needs — they're processing
              it now. Payouts will unlock automatically when it clears. No
              action needed from you.
            </p>
          </div>
        );
      })()}

      {payouts.length === 0 ? (
        <p className="px-4 py-3 text-sm text-text-muted">
          No payouts yet — your first one happens once you've received bookings.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {payouts.map((p) => {
            const status = statusLabel(p.status);
            const toneClass =
              status.tone === "green"
                ? "text-success"
                : status.tone === "amber"
                  ? "text-warning"
                  : status.tone === "danger"
                    ? "text-danger"
                    : "text-text-muted";
            return (
              <div
                key={p.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <div className="flex items-center gap-2.5">
                  <TrendingUp className="size-3.5 text-text-muted" />
                  <span className="text-text-primary">
                    {formatMoney(p.amount_cents, p.currency)}
                  </span>
                  <span className="text-xs text-text-muted">
                    → {formatDate(p.arrival_date_iso)}
                  </span>
                </div>
                <span className={`text-xs font-medium ${toneClass}`}>
                  {status.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
