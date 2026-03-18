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
  logout: () => void;
  getRoleHome: (role: Role) => string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchUserProfile(supabase: ReturnType<typeof createClient>, authUserId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, restaurant_id")
    .eq("auth_user_id", authUserId)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    email: data.email ?? "",
    fullName: data.full_name ?? "",
    role: data.role as Role,
    restaurantId: data.restaurant_id,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function initAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const profile = await fetchUserProfile(supabase, session.user.id);
        setUser(profile);
      } else {
        setUser(null);
      }
      setLoading(false);
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          const profile = await fetchUserProfile(supabase, session.user.id);
          setUser(profile);
        } else {
          setUser(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [supabase]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  const getRoleHome = useCallback((role: Role) => ROLE_HOME[role], []);

  return (
    <AuthContext.Provider value={{ user, loading, logout, getRoleHome }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
