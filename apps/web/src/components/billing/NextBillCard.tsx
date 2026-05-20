// NextBillCard — shows "Next bill: $204.99 (Jun 1)" with a live running
// total of the restaurant's accumulated booking fees + subscription line.
// Powered by stripe.invoices.retrieveUpcoming via get-next-bill-preview.
//
// Renders nothing visible while loading (skeleton). On error or no-active-
// subscription, falls back to a small explanatory note rather than failing.

import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";

import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

interface NextBillCardProps {
  restaurantId: string;
  className?: string;
}

interface NextBillLineItem {
  description: string;
  amount_cents: number;
  quantity: number;
  is_subscription: boolean;
}

interface NextBillResponse {
  ok: boolean;
  has_upcoming: boolean;
  next_amount_cents?: number;
  next_date_iso?: string | null;
  currency?: string;
  line_items?: NextBillLineItem[];
  reason?: string;
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function NextBillCard({ restaurantId, className }: NextBillCardProps) {
  const [data, setData] = useState<NextBillResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      if (!isSupabaseConfigured()) {
        if (!cancelled) {
          setLoading(false);
          setError("Supabase not configured");
        }
        return;
      }
      try {
        const client = getSupabaseBrowserClient();
        const { data: sessionData } = await client.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          if (!cancelled) {
            setLoading(false);
            setError("Not signed in");
          }
          return;
        }
        const res = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/get-next-bill-preview`,
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
        const body = (await res.json().catch(() => null)) as NextBillResponse | null;
        if (cancelled) return;
        if (!res.ok || !body || body.ok === false) {
          setError((body as { error?: string } | null)?.error ?? "Failed to load");
          setLoading(false);
          return;
        }
        setData(body);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  if (loading) {
    return (
      <div
        className={`flex items-center gap-2 rounded-xl border border-border bg-bg-surface/40 px-4 py-3 ${className ?? ""}`}
      >
        <Receipt className="size-4 text-text-muted" />
        <span className="text-sm text-text-muted">Loading next bill…</span>
      </div>
    );
  }

  if (error || !data) {
    return null; // Silent — don't clutter the UI on errors. SettingsPage has
    // the full invoice history below us.
  }

  if (!data.has_upcoming) {
    const reason = data.reason ?? "no_subscription";
    let copy = "No upcoming bill yet.";
    if (reason === "trialing") {
      copy = "You're in your free trial. The first bill arrives at the end of the trial.";
    } else if (reason === "no_customer") {
      copy = "Set up your payment method to see your next bill estimate.";
    }
    return (
      <div
        className={`flex items-start gap-2.5 rounded-xl border border-border bg-bg-surface/40 px-4 py-3 ${className ?? ""}`}
      >
        <Receipt className="size-4 mt-0.5 text-text-muted" />
        <p className="text-sm text-text-muted">{copy}</p>
      </div>
    );
  }

  const amount = formatMoney(
    data.next_amount_cents ?? 0,
    data.currency ?? "cad",
  );
  const dateStr = formatDate(data.next_date_iso);
  const lineItems = data.line_items ?? [];

  const subscriptionLine = lineItems.find((li) => li.is_subscription);
  const feeLines = lineItems.filter((li) => !li.is_subscription);
  const totalFeeCents = feeLines.reduce((acc, li) => acc + li.amount_cents, 0);
  const totalFeeQty = feeLines.reduce((acc, li) => acc + (li.quantity ?? 1), 0);

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-border bg-bg-surface/40 px-4 py-3 ${className ?? ""}`}
    >
      <Receipt className="size-4 mt-0.5 text-warning" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary">
          Next bill: <span className="font-semibold">{amount}</span>
          {dateStr ? (
            <span className="text-text-muted"> · {dateStr}</span>
          ) : null}
        </div>
        {(subscriptionLine || totalFeeCents > 0) ? (
          <div className="mt-1 text-xs text-text-muted">
            {subscriptionLine
              ? `${formatMoney(subscriptionLine.amount_cents, data.currency ?? "cad")} subscription`
              : null}
            {subscriptionLine && totalFeeCents > 0 ? " + " : null}
            {totalFeeCents > 0
              ? `${formatMoney(totalFeeCents, data.currency ?? "cad")} from ${totalFeeQty} booking${totalFeeQty === 1 ? "" : "s"} this month so far`
              : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
