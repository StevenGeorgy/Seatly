import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useUser } from "@/hooks/useUser";
import { useStaffRestaurants, type StaffRestaurantRow } from "@/hooks/useStaffRestaurants";

const STORAGE_KEY = "seatly.selectedRestaurantId";

export type RestaurantScopeValue = {
  selectedRestaurantId: string | null;
  setSelectedRestaurantId: (id: string) => void;
  restaurants: StaffRestaurantRow[];
  loading: boolean;
  error: Error | null;
};

const RestaurantScopeContext = createContext<RestaurantScopeValue | null>(null);

type RestaurantScopeProviderProps = {
  children: ReactNode;
};

export function RestaurantScopeProvider({ children }: RestaurantScopeProviderProps) {
  const { restaurantRoles, primaryRestaurantRole } = useUser();
  const { restaurants, loading, error } = useStaffRestaurants(restaurantRoles);
  const [selectedRestaurantId, setSelectedState] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const restaurantIds = useMemo(
    () =>
      [...restaurants]
        .map((r) => r.id)
        .sort()
        .join(","),
    [restaurants],
  );

  useEffect(() => {
    if (loading) {
      return;
    }

    setSelectedState((prev) => {
      if (restaurants.length === 0) {
        return null;
      }
      if (prev && restaurants.some((r) => r.id === prev)) {
        return prev;
      }

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && restaurants.some((r) => r.id === stored)) {
        return stored;
      }

      const primary = primaryRestaurantRole?.restaurant_id;
      if (primary && restaurants.some((r) => r.id === primary)) {
        localStorage.setItem(STORAGE_KEY, primary);
        return primary;
      }

      const first = restaurants[0]?.id;
      if (first) {
        localStorage.setItem(STORAGE_KEY, first);
      }
      return first ?? null;
    });

    setInitialized(true);
  }, [loading, restaurantIds, primaryRestaurantRole?.restaurant_id, restaurants.length]);

  const setSelectedRestaurantId = useCallback((id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setSelectedState(id);
  }, []);

  const value = useMemo(
    (): RestaurantScopeValue => ({
      selectedRestaurantId,
      setSelectedRestaurantId,
      restaurants,
      loading: loading || !initialized,
      error,
    }),
    [
      selectedRestaurantId,
      setSelectedRestaurantId,
      restaurants,
      loading,
      initialized,
      error,
    ],
  );

  return (
    <RestaurantScopeContext.Provider value={value}>{children}</RestaurantScopeContext.Provider>
  );
}

export function useRestaurantScope(): RestaurantScopeValue {
  const ctx = useContext(RestaurantScopeContext);
  if (!ctx) {
    throw new Error("useRestaurantScope must be used within RestaurantScopeProvider");
  }
  return ctx;
}
