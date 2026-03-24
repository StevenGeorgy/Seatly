import type { Session, SupabaseClient } from "@supabase/supabase-js";

import {
  isStaffRole,
  type UserProfile,
  type UserRestaurantRole,
} from "@/types/auth";

const PROFILE_COLUMNS =
  "id, auth_user_id, full_name, phone, email, avatar_url, role, restaurant_id, birthday, dietary_restrictions, allergies, seating_preference, noise_preference, preferred_language, notification_preferences_json, car_details_json, stripe_payment_method_id, created_at";

const ROLE_COLUMNS =
  "id, user_id, restaurant_id, role, is_primary, hourly_rate, employment_type, created_at";

export type LoadUserContextResult =
  | { ok: true; profile: UserProfile | null; restaurantRoles: UserRestaurantRole[] }
  | { ok: false; error: Error };

function parseHourlyRate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapRestaurantRole(row: {
  id: string;
  user_id: string;
  restaurant_id: string;
  role: string;
  is_primary: boolean | null;
  hourly_rate: unknown;
  employment_type: string | null;
  created_at: string | null;
}): UserRestaurantRole | null {
  if (!isStaffRole(row.role)) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    restaurant_id: row.restaurant_id,
    role: row.role,
    is_primary: row.is_primary ?? false,
    hourly_rate: parseHourlyRate(row.hourly_rate),
    employment_type: row.employment_type,
    created_at: row.created_at,
  };
}

/**
 * Loads `user_profiles` + `user_restaurant_roles` for the authenticated user.
 * Kept out of React components (Bible: queries not in UI components).
 */
export async function loadUserContext(
  client: SupabaseClient,
  session: Session | null,
): Promise<LoadUserContextResult> {
  if (!session?.user) {
    return { ok: true, profile: null, restaurantRoles: [] };
  }

  const { data: profile, error: profileError } = await client
    .from("user_profiles")
    .select(PROFILE_COLUMNS)
    .eq("auth_user_id", session.user.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false, error: new Error(profileError.message) };
  }

  if (!profile) {
    return { ok: true, profile: null, restaurantRoles: [] };
  }

  const typedProfile = profile as UserProfile;

  const { data: roleRows, error: rolesError } = await client
    .from("user_restaurant_roles")
    .select(ROLE_COLUMNS)
    .eq("user_id", typedProfile.id);

  if (rolesError) {
    return { ok: false, error: new Error(rolesError.message) };
  }

  const restaurantRoles = (roleRows ?? [])
    .map((row) =>
      mapRestaurantRole(
        row as {
          id: string;
          user_id: string;
          restaurant_id: string;
          role: string;
          is_primary: boolean | null;
          hourly_rate: unknown;
          employment_type: string | null;
          created_at: string | null;
        },
      ),
    )
    .filter((r): r is UserRestaurantRole => r !== null);

  return { ok: true, profile: typedProfile, restaurantRoles };
}
