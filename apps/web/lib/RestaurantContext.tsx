"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthContext";

interface RestaurantContextValue {
  restaurantName: string | null;
  loading: boolean;
}

const RestaurantContext = createContext<RestaurantContextValue | null>(null);

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;

    async function fetchRestaurant() {
      if (!user?.restaurantId) {
        setRestaurantName(null);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("restaurants")
          .select("name")
          .eq("id", user.restaurantId)
          .single();

        if (cancelled) return;
        if (error || !data) {
          setRestaurantName(null);
        } else {
          setRestaurantName(data.name ?? null);
        }
      } catch {
        if (!cancelled) setRestaurantName(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    void fetchRestaurant();
  }, [user?.restaurantId, supabase]);

  const value = useMemo(
    () => ({
      restaurantName,
      loading,
    }),
    [restaurantName, loading]
  );

  return (
    <RestaurantContext.Provider value={value}>
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurant() {
  const ctx = useContext(RestaurantContext);
  if (!ctx) {
    throw new Error("useRestaurant must be used within RestaurantProvider");
  }
  return ctx;
}
