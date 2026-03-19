"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User, Role } from "@seatly/types";

const ROLE_HOME: Record<Role, string> = {
  owner: "/dashboard",
  host: "/floor-plan",
  waiter: "/my-tables",
  kitchen: "/kitchen",
  admin: "/admin",
  customer: "/dashboard",
};

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  getRoleHome: (role: Role) => string;
  setUserFromSession: (profile: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchUserProfile(
  supabase: ReturnType<typeof createClient>,
  authUserId: string
): Promise<User | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, restaurant_id, avatar_url")
    .eq("auth_user_id", authUserId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    email: data.email ?? "",
    fullName: data.full_name ?? "",
    role: data.role as Role,
    restaurantId: data.restaurant_id,
    avatarUrl: data.avatar_url ?? null,
  };
}

function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeMessage = "message" in error ? (error as { message?: unknown }).message : null;
  const message = typeof maybeMessage === "string" ? maybeMessage.toLowerCase() : "";
  return (
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found")
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;

    async function initAuth() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (session?.user) {
          const profile = await fetchUserProfile(supabase, session.user.id);
          if (!cancelled) setUser(profile);
        } else {
          setUser(null);
        }
      } catch (error) {
        if (isInvalidRefreshTokenError(error)) {
          // Local browser token is stale/corrupt; clear local auth state quietly.
          await supabase.auth.signOut({ scope: "local" });
          if (!cancelled) setUser(null);
        } else {
          throw error;
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer DB calls — awaiting supabase.from inside this callback can deadlock auth (stuck loading).
      queueMicrotask(() => {
        void (async () => {
          try {
            if (session?.user) {
              const profile = await fetchUserProfile(supabase, session.user.id);
              if (!cancelled) setUser(profile);
            } else if (!cancelled) {
              setUser(null);
            }
          } finally {
            if (!cancelled) setLoading(false);
          }
        })();
      });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  const getRoleHome = useCallback((role: Role) => ROLE_HOME[role], []);

  const setUserFromSession = useCallback((profile: User) => {
    setUser(profile);
    setLoading(false);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      logout,
      getRoleHome,
      setUserFromSession,
    }),
    [user, loading, logout, getRoleHome, setUserFromSession]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
