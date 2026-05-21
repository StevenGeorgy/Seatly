// Shared owner-of-restaurant authorization helpers.
//
// Previously every billing/Stripe edge fn copy-pasted this two-query
// pattern (lookup user_profiles by auth_user_id, then look up
// user_restaurant_roles with role='owner'). Centralizing here keeps the
// auth surface uniform.
//
// `isOwnerOfRestaurant` returns a plain boolean. `getOwnerRestaurantRole`
// returns the matching user_profile id (some callers — publish-restaurant,
// save-subscription-payment-method — need the profile id for downstream
// writes like the consent log).
//
// Both helpers check role='owner' ONLY. Edge fns that authorize broader
// staff roles (manager/host/server) must keep their inline checks — this
// helper deliberately does NOT widen.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function isOwnerOfRestaurant(
  supabaseAdmin: SupabaseClient,
  authUserId: string,
  restaurantId: string,
): Promise<boolean> {
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!profile) return false;
  const { data: role } = await supabaseAdmin
    .from("user_restaurant_roles")
    .select("role")
    .eq("user_id", (profile as { id: string }).id)
    .eq("restaurant_id", restaurantId)
    .eq("role", "owner")
    .maybeSingle();
  return Boolean(role);
}

export async function getOwnerRestaurantRole(
  supabaseAdmin: SupabaseClient,
  authUserId: string,
  restaurantId: string,
): Promise<{ ok: boolean; userProfileId: string | null }> {
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!profile) return { ok: false, userProfileId: null };
  const userProfileId = (profile as { id: string }).id;
  const { data: role } = await supabaseAdmin
    .from("user_restaurant_roles")
    .select("role")
    .eq("user_id", userProfileId)
    .eq("restaurant_id", restaurantId)
    .eq("role", "owner")
    .maybeSingle();
  return { ok: Boolean(role), userProfileId };
}
