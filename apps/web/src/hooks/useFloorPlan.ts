import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_TABLES, MOCK_SECTIONS } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type TableRow = {
  id: string;
  restaurant_id: string;
  table_number: string | null;
  label: string | null;
  capacity: number;
  min_party: number | null;
  section: string | null;
  section_id: string | null;
  position_x: number | null;
  position_y: number | null;
  shape: string;
  status: string;
  combined_with: string[] | null;
  qr_code_url: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string | null;
};

export type FloorPlanRow = {
  id: string;
  restaurant_id: string;
  section_id: string | null;
  name: string;
  layout: { walls: unknown[]; tables: unknown[]; decorations: unknown[] } | null;
  canvas_width: number;
  canvas_height: number;
  is_active: boolean;
};

export type SectionRow = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export function useFloorPlan() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [floorPlans, setFloorPlans] = useState<FloorPlanRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setTables([]);
      setFloorPlans([]);
      setSections([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const [tablesRes, plansRes, sectionsRes] = await Promise.all([
      client.from("tables").select("*").eq("restaurant_id", selectedRestaurantId).eq("is_active", true),
      client.from("floor_plans").select("*").eq("restaurant_id", selectedRestaurantId).eq("is_active", true),
      client.from("restaurant_sections").select("*").eq("restaurant_id", selectedRestaurantId).eq("is_active", true).order("sort_order"),
    ]);

    if (tablesRes.error || plansRes.error || sectionsRes.error) {
      setError(new Error(tablesRes.error?.message ?? plansRes.error?.message ?? sectionsRes.error?.message ?? "Unknown error"));
    }

    const rawTables = (tablesRes.data ?? []) as TableRow[];
    const rawSections = (sectionsRes.data ?? []) as SectionRow[];
    setTables(rawTables.length > 0 ? rawTables : MOCK_TABLES);
    setFloorPlans((plansRes.data ?? []) as FloorPlanRow[]);
    setSections(rawSections.length > 0 ? rawSections : MOCK_SECTIONS);
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`tables:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tables", filter: `restaurant_id=eq.${selectedRestaurantId}` },
        () => { void fetchAll(); },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [selectedRestaurantId, fetchAll]);

  return { tables, floorPlans, sections, loading, error, refetch: fetchAll };
}
