import { createContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

import type { UserProfile, UserRestaurantRole } from "@/types/auth";

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  /** Rows from user_restaurant_roles for this profile. Empty => customer (Bible). */
  restaurantRoles: UserRestaurantRole[];
  loading: boolean;
  error: Error | null;
  /** True if any `user_restaurant_roles` row exists (staff experience). */
  isStaff: boolean;
  /** True when staff intentionally enter the customer experience. */
  isCustomerView: boolean;
  /** Staff accounts can switch to customer view without signing out. */
  canUseCustomerView: boolean;
  signOut: () => Promise<void>;
  switchToCustomerView: () => void;
  switchToStaffView: () => void;
  /** Re-fetch profile + roles after mutations (e.g. onboarding). */
  refreshUser: () => Promise<void>;
  /** Primary row: `is_primary`, else first role. */
  primaryRestaurantRole: UserRestaurantRole | null;
  rolesAtRestaurant: (restaurantId: string) => UserRestaurantRole[];
  hasStaffRole: (role: UserRestaurantRole["role"]) => boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
