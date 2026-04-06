import { useCallback, useEffect, useRef, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import i18n from "@/lib/i18n/i18n";
import { nextSequentialTableNumber } from "@/lib/table-number";
import { promiseWithTimeout } from "@/lib/promise-timeout";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

/** Prevents hung Supabase calls from leaving `loading` stuck forever. */
const FLOOR_PLAN_FETCH_TIMEOUT_MS = 45_000;

/** Postgres `uuid` columns reject mock ids like `t-8`; treat those as local-only rows. */
export function isDatabaseUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

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
  seated_count: number;
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

/** Visual floor zone (Main Dining, Patio, …) — layout-only, draggable/resizable in edit mode. */
export type FloorPlanZone = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Shown top-left inside the zone */
  label: string;
};

export type FloorPlanLayout = {
  walls: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  doors: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  windows: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  tableTransforms: Record<string, { rotation: number; scaleX: number; scaleY: number }>;
  decorations: DecorationItem[];
  /** Room zones — tinted regions with labels (Konva). */
  zones: FloorPlanZone[];
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

export function useFloorPlan(options?: { pauseRealtime?: boolean }) {
  const pauseRealtime = options?.pauseRealtime ?? false;
  const { selectedRestaurantId } = useRestaurantScope();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [floorPlans, setFloorPlans] = useState<FloorPlanRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  /** Dismisses stale responses when `selectedRestaurantId` changes mid-flight. */
  const fetchSeqRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setTables([]);
      setFloorPlans([]);
      setSections([]);
      setLoading(false);
      return;
    }

    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const client = getSupabaseBrowserClient();

      const [tablesRes, plansRes, sectionsRes] = await promiseWithTimeout(
        Promise.all([
          client.from("tables").select("*").eq("restaurant_id", selectedRestaurantId).eq("is_active", true),
          client.from("floor_plans").select("*").eq("restaurant_id", selectedRestaurantId).eq("is_active", true),
          client.from("restaurant_sections").select("*").eq("restaurant_id", selectedRestaurantId).eq("is_active", true).order("sort_order"),
        ]),
        FLOOR_PLAN_FETCH_TIMEOUT_MS,
        "Floor plan load",
      );

      if (seq !== fetchSeqRef.current) return;

      if (tablesRes.error || plansRes.error || sectionsRes.error) {
        setError(
          new Error(tablesRes.error?.message ?? plansRes.error?.message ?? sectionsRes.error?.message ?? "Unknown error"),
        );
      } else {
        setError(null);
      }

      const rawTables = (tablesRes.data ?? []) as TableRow[];
      const rawSections = (sectionsRes.data ?? []) as SectionRow[];
      setTables(rawTables);
      setFloorPlans((plansRes.data ?? []) as FloorPlanRow[]);
      setSections(rawSections);
    } catch (e) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      setTables([]);
      setFloorPlans([]);
      setSections([]);
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false);
      }
    }
  }, [selectedRestaurantId]);

  const createSectionAndFloor = useCallback(
    async (name: string): Promise<{ sectionId: string; floorPlanId: string } | null> => {
      if (!selectedRestaurantId || !isSupabaseConfigured()) return null;
      const client = getSupabaseBrowserClient();

      const nextSortOrder =
        sections.reduce((max, s) => Math.max(max, s.sort_order), -1) + 1;

      const sectionRes = await client
        .from("restaurant_sections")
        .insert({
          restaurant_id: selectedRestaurantId,
          name,
          sort_order: nextSortOrder,
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
          canvas_width: 720,
          canvas_height: 480,
          layout: {
            walls: [],
            doors: [],
            windows: [],
            tableTransforms: {},
            decorations: [],
            zones: [],
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
    [fetchAll, sections, selectedRestaurantId],
  );

  const createTable = useCallback(
    async (input: {
      sectionId: string;
      label: string;
      shape: string;
      capacity: number;
      x: number;
      y: number;
      tableNumber?: string | null;
      minParty?: number | null;
      status?: string;
      notes?: string | null;
    }): Promise<TableRow | null> => {
      if (!selectedRestaurantId || !isSupabaseConfigured()) return null;
      if (!isDatabaseUuid(input.sectionId)) {
        setError(
          new Error(i18n.t("dashboard.floorPlan.sectionRequiredForTable")),
        );
        return null;
      }
      const client = getSupabaseBrowserClient();
      const sectionName = sections.find((s) => s.id === input.sectionId)?.name ?? null;
      const tableNumber =
        input.tableNumber?.trim() || nextSequentialTableNumber(tables);

      const res = await client
        .from("tables")
        .insert({
          restaurant_id: selectedRestaurantId,
          table_number: tableNumber,
          label: input.label.trim() || null,
          capacity: Math.max(1, input.capacity),
          min_party: input.minParty ?? 1,
          section_id: input.sectionId,
          section: sectionName,
          position_x: input.x,
          position_y: input.y,
          shape: input.shape,
          status: input.status ?? "empty",
          notes: input.notes ?? null,
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
    [sections, selectedRestaurantId, tables],
  );

  const updateTable = useCallback(async (tableId: string, patch: Partial<TableRow>) => {
    const sanitized: Partial<TableRow> = { ...patch };
    if ("table_number" in sanitized) {
      const tn = sanitized.table_number;
      if (tn == null || (typeof tn === "string" && tn.trim() === "")) {
        delete sanitized.table_number;
      } else if (typeof tn === "string") {
        sanitized.table_number = tn.trim();
      }
    }

    if (!isDatabaseUuid(tableId)) {
      setTables((prev) => prev.map((t) => (t.id === tableId ? { ...t, ...sanitized } : t)));
      setError(null);
      return true;
    }
    if (!isSupabaseConfigured()) return false;
    if (Object.keys(sanitized).length === 0) return true;
    const client = getSupabaseBrowserClient();
    const res = await client.from("tables").update(sanitized).eq("id", tableId);
    if (res.error) {
      setError(new Error(res.error.message));
      return false;
    }
    return true;
  }, []);

  const deleteTable = useCallback(async (tableId: string, options?: { refetchAfter?: boolean }) => {
    const refetchAfter = options?.refetchAfter ?? true;
    if (!isDatabaseUuid(tableId)) {
      setTables((prev) => prev.filter((t) => t.id !== tableId));
      setError(null);
      return true;
    }
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const res = await client.from("tables").update({ is_active: false }).eq("id", tableId);
    if (res.error) {
      setError(new Error(res.error.message));
      return false;
    }
    if (refetchAfter) await fetchAll();
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
    if (!selectedRestaurantId || !isSupabaseConfigured() || pauseRealtime) return;

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
  }, [selectedRestaurantId, fetchAll, pauseRealtime]);

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
