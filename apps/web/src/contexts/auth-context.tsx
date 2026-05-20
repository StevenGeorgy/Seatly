import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { AuthContext, type AuthContextValue } from "@/contexts/auth-context-value";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadUserContext } from "@/lib/supabase/load-user-context";
import type { UserProfile, UserRestaurantRole } from "@/types/auth";

const VIEW_MODE_STORAGE_KEY = "cenaiva:view-mode";
type ViewMode = "staff" | "customer";

type AuthProviderProps = {
  children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
  const mountedRef = useRef(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [restaurantRoles, setRestaurantRoles] = useState<UserRestaurantRole[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "staff";
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "customer"
      ? "customer"
      : "staff";
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applySession = useCallback(async (nextSession: Session | null) => {
    if (!mountedRef.current) return;

    setSession(nextSession);
    setUser(nextSession?.user ?? null);

    if (!nextSession?.user) {
      setProfile(null);
      setRestaurantRoles([]);
      setViewMode("staff");
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    if (!isSupabaseConfigured()) {
      setProfile(null);
      setRestaurantRoles([]);
      setViewMode("staff");
      setError(new Error("Supabase env vars are not set."));
      setLoading(false);
      return;
    }

    const client = getSupabaseBrowserClient();
    const result = await loadUserContext(client, nextSession);

    if (!mountedRef.current) return;

    if (!result.ok) {
      setProfile(null);
      setRestaurantRoles([]);
      setViewMode("staff");
      setError(result.error);
      setLoading(false);
      return;
    }

    setProfile(result.profile);
    setRestaurantRoles(result.restaurantRoles);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      void Promise.resolve().then(() => applySession(null));
      return;
    }

    const client = getSupabaseBrowserClient();
    let cancelled = false;

    void (async () => {
      const {
        data: { session: initial },
      } = await client.auth.getSession();
      if (!cancelled) await applySession(initial);
    })();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      await applySession(null);
      return;
    }

    const client = getSupabaseBrowserClient();
    setLoading(true);
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) {
      setError(new Error(signOutError.message));
      setLoading(false);
      return;
    }
    await applySession(null);
  }, [applySession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const refreshUser = useCallback(async () => {
    // Silent profile refresh. We intentionally do NOT go through
    // applySession() here because that helper flips `loading=true` while
    // it re-fetches — and any RequireAuth-gated page (e.g. the onboarding
    // wizard) renders <RouteFallback/> while loading, which unmounts the
    // child tree. Awaiting refreshUser() mid-submit therefore destroyed
    // in-flight wizard state (the setStep(2) call would fire on the
    // already-unmounted SetupPage and be a no-op), bouncing the user back
    // to a freshly-mounted Step 1. Refresh in place, no loading flicker.
    if (!isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const {
      data: { session: current },
    } = await client.auth.getSession();
    if (!mountedRef.current) return;

    if (!current?.user) {
      // Session vanished — fall through to applySession which handles the
      // signed-out reset (loading toggle is fine here because the user
      // already lost their session).
      await applySession(current);
      return;
    }

    const result = await loadUserContext(client, current);
    if (!mountedRef.current) return;

    setSession(current);
    setUser(current.user);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setProfile(result.profile);
    setRestaurantRoles(result.restaurantRoles);
    setError(null);
  }, [applySession]);

  const primaryRestaurantRole = useMemo((): UserRestaurantRole | null => {
    if (restaurantRoles.length === 0) return null;
    const primary = restaurantRoles.find((r) => r.is_primary);
    return primary ?? restaurantRoles[0] ?? null;
  }, [restaurantRoles]);

  const rolesAtRestaurant = useCallback((restaurantId: string) => {
    const id = restaurantId.trim();
    if (!id) return [];
    const norm = (u: string) => u.replace(/-/g, "").toLowerCase();
    const target = norm(id);
    return restaurantRoles.filter((r) => norm(r.restaurant_id) === target);
  }, [restaurantRoles]);

  const hasStaffRole = useCallback(
    (role: UserRestaurantRole["role"]) => restaurantRoles.some((r) => r.role === role),
    [restaurantRoles],
  );

  const canUseCustomerView = useMemo(
    () => restaurantRoles.length > 0,
    [restaurantRoles],
  );

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (restaurantRoles.length === 0 && viewMode !== "staff") {
        setViewMode("staff");
        return;
      }
      if (!canUseCustomerView && viewMode === "customer") {
        setViewMode("staff");
      }
    });
  }, [restaurantRoles.length, canUseCustomerView, viewMode]);

  const switchToCustomerView = useCallback(() => {
    if (!canUseCustomerView) return;
    setViewMode("customer");
  }, [canUseCustomerView]);

  const switchToStaffView = useCallback(() => {
    setViewMode("staff");
  }, []);

  const isCustomerView = canUseCustomerView && viewMode === "customer";
  const isStaff = restaurantRoles.length > 0 && !isCustomerView;

  const value = useMemo(
    (): AuthContextValue => ({
      session,
      user,
      profile,
      restaurantRoles,
      loading,
      error,
      isStaff,
      isCustomerView,
      canUseCustomerView,
      signOut,
      switchToCustomerView,
      switchToStaffView,
      refreshUser,
      primaryRestaurantRole,
      rolesAtRestaurant,
      hasStaffRole,
    }),
    [
      session,
      user,
      profile,
      restaurantRoles,
      loading,
      error,
      isStaff,
      isCustomerView,
      canUseCustomerView,
      signOut,
      switchToCustomerView,
      switchToStaffView,
      refreshUser,
      primaryRestaurantRole,
      rolesAtRestaurant,
      hasStaffRole,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
