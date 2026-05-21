// PayoutsSection — shows the restaurant's Stripe Connect payouts: pending
// balance + recent payout history with bank-arrival dates. Powered by
// list-stripe-payouts edge fn (calls stripe.payouts.list + balance.retrieve
// on the connected account).
//
// Helpful for restaurants who see diners pay but wonder "where's the money
// in my bank?" — the answer is Stripe's 2-7 day rolling payout schedule.

import { useEffect, useState } from "react";
import { AlertTriangle, Landmark, RefreshCw, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";

import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { StripeConnectVerifyPanel } from "@/components/billing/StripeConnectVerifyPanel";

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
      } catch {
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
          <StripeConnectVerifyPanel
            restaurantId={restaurantId}
            onboardingMode
            onExit={() => {
              // After the embedded onboarding closes, re-fetch payouts so
              // the panel transitions from "no account" → "verifying" /
              // "payouts enabled" without a manual reload.
              setRefreshKey((k) => k + 1);
            }}
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

      {!data.payouts_enabled ? (
        <>
          <div className="space-y-1 border-b border-border bg-warning/5 px-4 py-3 text-xs text-warning">
            <p className="font-semibold">Payouts pending Stripe verification</p>
            <p className="text-text-secondary">
              You can take diner deposits right now — that's already working.
              Payouts to your bank are paused while Stripe verifies your
              account. If Stripe needs anything specific from you, it'll
              appear as an actionable banner in the panel below; otherwise
              this usually clears within 24 hours (occasionally up to 2-3
              business days).
            </p>
          </div>
          <div className="border-b border-border p-4">
            <StripeConnectVerifyPanel
              restaurantId={restaurantId}
              onExit={() => {
                // After Stripe closes the embedded onboarding, re-fetch the
                // payouts payload so the banner updates without a manual reload.
                setRefreshKey((k) => k + 1);
              }}
            />
          </div>
        </>
      ) : null}

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
