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

export type FloorPlanLayout = {
  walls: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  doors: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  windows: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  tableTransforms: Record<string, { rotation: number; scaleX: number; scaleY: number }>;
  decorations: DecorationItem[];
};

export type DecorationItem = {
  id: string;
  type: "host_stand" | "sofa" | "planter" | "divider" | "service_station";
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
  label: string | null;
  seats: number | null;
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

  const createSectionAndFloor = useCallback(
    async (name: string): Promise<{ sectionId: string; floorPlanId: string } | null> => {
      if (!selectedRestaurantId || !isSupabaseConfigured()) return null;
      const client = getSupabaseBrowserClient();

      const sectionRes = await client
        .from("restaurant_sections")
        .insert({
          restaurant_id: selectedRestaurantId,
          name,
          sort_order: sections.length,
          is_active: true,
        })
        .select("id")
        .single();
      if (sectionRes.error || !sectionRes.data) {
        setError(new Error(sectionRes.error?.message ?? "Failed to create floor"));
        return null;
      }

      const sectionId = sectionRes.data.id as string;
      const floorPlanRes = await client
        .from("floor_plans")
        .insert({
          restaurant_id: selectedRestaurantId,
          section_id: sectionId,
          name,
          canvas_width: 1000,
          canvas_height: 700,
          layout: {
            walls: [],
            doors: [],
            windows: [],
            tableTransforms: {},
            decorations: [],
          } satisfies FloorPlanLayout,
          is_active: true,
        })
        .select("id")
        .single();
      if (floorPlanRes.error || !floorPlanRes.data) {
        setError(new Error(floorPlanRes.error?.message ?? "Failed to create floor layout"));
        return null;
      }

      await fetchAll();
      return { sectionId, floorPlanId: floorPlanRes.data.id as string };
    },
    [fetchAll, sections.length, selectedRestaurantId],
  );

  const createTable = useCallback(
    async (input: {
      sectionId: string;
      label: string;
      shape: string;
      capacity: number;
      x: number;
      y: number;
    }): Promise<TableRow | null> => {
      if (!selectedRestaurantId || !isSupabaseConfigured()) return null;
      const client = getSupabaseBrowserClient();
      const sectionName = sections.find((s) => s.id === input.sectionId)?.name ?? null;
      const tableNumber = input.label.trim() || `T${Date.now().toString().slice(-4)}`;

      const res = await client
        .from("tables")
        .insert({
          restaurant_id: selectedRestaurantId,
          table_number: tableNumber,
          label: input.label.trim() || null,
          capacity: Math.max(1, input.capacity),
          min_party: 1,
          section_id: input.sectionId,
          section: sectionName,
          position_x: input.x,
          position_y: input.y,
          shape: input.shape,
          status: "empty",
          is_active: true,
        })
        .select("*")
        .single();
      if (res.error || !res.data) {
        setError(new Error(res.error?.message ?? "Failed to add table"));
        return null;
      }
      return res.data as TableRow;
    },
    [sections, selectedRestaurantId],
  );

  const updateTable = useCallback(async (tableId: string, patch: Partial<TableRow>) => {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const res = await client.from("tables").update(patch).eq("id", tableId);
    if (res.error) {
      setError(new Error(res.error.message));
      return false;
    }
    return true;
  }, []);

  const deleteTable = useCallback(async (tableId: string) => {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const res = await client.from("tables").update({ is_active: false }).eq("id", tableId);
    if (res.error) {
      setError(new Error(res.error.message));
      return false;
    }
    await fetchAll();
    return true;
  }, [fetchAll]);

  const updateLayout = useCallback(async (floorPlanId: string, layout: FloorPlanLayout) => {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const res = await client.from("floor_plans").update({ layout }).eq("id", floorPlanId);
    if (res.error) {
      setError(new Error(res.error.message));
      return false;
    }
    return true;
  }, []);

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

  return {
    tables,
    floorPlans,
    sections,
    loading,
    error,
    refetch: fetchAll,
    createSectionAndFloor,
    createTable,
    updateTable,
    deleteTable,
    updateLayout,
  };
}
