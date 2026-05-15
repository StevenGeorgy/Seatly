import { useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { RestaurantDepositTier } from "@/hooks/useStaffRestaurants";

export type RestaurantSetupCompletion = {
  loading: boolean;
  stepsComplete: number;
  totalSteps: number;
};

const TOTAL_STEPS = 8;

export function useRestaurantSetupCompletion(restaurantId: string | null): RestaurantSetupCompletion {
  const [loading, setLoading] = useState(true);
  const [stepsComplete, setStepsComplete] = useState(0);

  useEffect(() => {
    if (!restaurantId || !isSupabaseConfigured()) {
      setLoading(false);
      setStepsComplete(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const client = getSupabaseBrowserClient();
      const [restaurantRes, tableRes, shiftRes, tierCategoryRes] = await Promise.all([
        client
          .from("restaurants")
          .select(
            "hours_json, cover_photo_url, deposit_tiers, is_published, stripe_account_id, stripe_charges_enabled, subscription_status",
          )
          .eq("id", restaurantId)
          .maybeSingle(),
        client
          .from("tables")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .limit(1),
        client
          .from("shifts")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .limit(1),
        client
          .from("menu_categories")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true)
          .eq("is_pricing_tier_source", true)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const row = restaurantRes.data as
        | {
            hours_json: Record<string, unknown> | null;
            cover_photo_url: string | null;
            deposit_tiers: RestaurantDepositTier[] | null;
            is_published: boolean | null;
            stripe_account_id: string | null;
            stripe_charges_enabled: boolean | null;
            subscription_status: string | null;
          }
        | null;
      const hours = row?.hours_json ?? null;
      const hasHours = hours !== null && Object.values(hours).some((v) => v !== null);
      const hasTables = (tableRes.data ?? []).length > 0;
      const hasShift = (shiftRes.data ?? []).length > 0;
      let hasMenuItems = false;
      const tierCategory = tierCategoryRes.data as { id: string } | null;
      if (tierCategory) {
        const { count } = await client
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("category_id", tierCategory.id)
          .eq("is_active", true);
        if (cancelled) return;
        hasMenuItems = (count ?? 0) >= 3;
      }
      const hasCover = Boolean(row?.cover_photo_url);
      const hasDepositPolicy = row?.deposit_tiers != null;
      // Step 8 is complete only when all four are satisfied:
      //   - Stripe Connect account exists + KYC verified (charges enabled)
      //   - Active or trialing subscription
      //   - Owner clicked Publish (is_published flipped to true)
      // The publish UPDATE in Step8PaymentSetup is itself gated client-side on
      // those KYC + subscription booleans, so all four collapse to is_published.
      const hasStripeAccount = Boolean(row?.stripe_account_id);
      const kycVerified = row?.stripe_charges_enabled === true;
      const subscriptionStatus = row?.subscription_status ?? null;
      const subscriptionActive =
        subscriptionStatus === "trialing" || subscriptionStatus === "active";
      const isPublished = row?.is_published === true;
      const step8Complete =
        hasStripeAccount && kycVerified && subscriptionActive && isPublished;
      const count =
        1 +
        (hasHours ? 1 : 0) +
        (hasTables ? 1 : 0) +
        (hasShift ? 1 : 0) +
        (hasMenuItems ? 1 : 0) +
        (hasCover ? 1 : 0) +
        (hasDepositPolicy ? 1 : 0) +
        (step8Complete ? 1 : 0);
      setStepsComplete(count);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return { loading, stepsComplete, totalSteps: TOTAL_STEPS };
}
