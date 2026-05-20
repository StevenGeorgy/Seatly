// CardOnFileBadge — small read-only widget that shows the brand + last 4 of
// the card backing the restaurant's Cenaiva subscription. Used next to the
// "Change card" / "Use a different card" buttons in the wizard Step 8 and
// the dashboard Settings page so owners can tell at a glance which card is
// on file before they swap it. Amazon-style "Visa ending in **** 4242".

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";

import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

interface CardInfo {
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
}

function formatBrand(brand: string | null): string {
  if (!brand) return "Card";
  const lower = brand.toLowerCase();
  if (lower === "visa") return "Visa";
  if (lower === "mastercard") return "Mastercard";
  if (lower === "amex" || lower === "american_express" || lower === "american express") return "Amex";
  if (lower === "discover") return "Discover";
  if (lower === "unionpay") return "UnionPay";
  if (lower === "jcb") return "JCB";
  if (lower === "diners") return "Diners";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

async function fetchCard(restaurantId: string): Promise<CardInfo | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return null;

  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/get-restaurant-payment-method`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: getSupabaseAnonKey(),
    },
    body: JSON.stringify({ restaurant_id: restaurantId }),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as
    | { has_card: boolean; brand?: string | null; last4?: string | null; exp_month?: number | null; exp_year?: number | null }
    | null;
  if (!body?.has_card) return null;
  return {
    brand: body.brand ?? null,
    last4: body.last4 ?? null,
    exp_month: body.exp_month ?? null,
    exp_year: body.exp_year ?? null,
  };
}

interface CardOnFileBadgeProps {
  /** Restaurant whose default PM we want to surface. */
  restaurantId: string;
  /** Bump this counter after a card-change to force a refetch. */
  refreshKey?: number;
  /** Override the default text color / size class. */
  className?: string;
}

export function CardOnFileBadge({ restaurantId, refreshKey = 0, className }: CardOnFileBadgeProps) {
  const [info, setInfo] = useState<CardInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const data = await fetchCard(restaurantId);
      if (cancelled) return;
      setInfo(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, refreshKey]);

  if (loading) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-sm text-text-muted ${className ?? ""}`}>
        <CreditCard className="size-4" /> Loading card…
      </span>
    );
  }
  if (!info?.last4) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 text-sm text-text-primary ${className ?? ""}`}>
      <CreditCard className="size-4 text-text-muted" />
      <span>
        {formatBrand(info.brand)} ending in{" "}
        <span className="font-medium">**** {info.last4}</span>
      </span>
      {info.exp_month && info.exp_year ? (
        <span className="text-xs text-text-muted">
          (exp {String(info.exp_month).padStart(2, "0")}/{String(info.exp_year).slice(2)})
        </span>
      ) : null}
    </span>
  );
}
