/** Staff roles — user_restaurant_roles.role (Bible + DB CHECK). No "customer" in this table. */
export type StaffRole =
  | "owner"
  | "manager"
  | "server"
  | "host"
  | "kitchen"
  | "bar"
  | "staff";

export const STAFF_ROLES: readonly StaffRole[] = [
  "owner",
  "manager",
  "server",
  "host",
  "kitchen",
  "bar",
  "staff",
] as const;

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** Columns we read from user_profiles (see Supabase migration + Bible). */
export type UserProfile = {
  id: string;
  auth_user_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  restaurant_id: string | null;
  birthday: string | null;
  dietary_restrictions: string[] | null;
  allergies: string[] | null;
  seating_preference: string | null;
  noise_preference: string | null;
  preferred_language: string | null;
  notification_preferences_json: Record<string, unknown> | null;
  car_details_json: Record<string, unknown> | null;
  stripe_payment_method_id: string | null;
  created_at: string | null;
};

export type UserRestaurantRole = {
  id: string;
  user_id: string;
  restaurant_id: string;
  role: StaffRole;
  is_primary: boolean;
  hourly_rate: number | null;
  employment_type: string | null;
  created_at: string | null;
};
