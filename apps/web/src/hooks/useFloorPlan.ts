import { useCallback, useEffect, useRef, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { toUserFacingError } from "@/lib/errors";
import { fetchFloorPlanBundle } from "@/lib/floor-plan-bundle-fetch";
import type { FloorPlanRow, SectionRow, TableRow } from "@/lib/floor-plan-db-types";
import { readFloorPlanCache, writeFloorPlanCache } from "@/lib/floor-plan-data-cache";
import i18n from "@/lib/i18n/i18n";
import { releaseReservationTables } from "@/lib/table-assignment";
import { nextSequentialTableNumber } from "@/lib/table-number";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type { FloorPlanRow, SectionRow, TableRow };

/**
 * Postgres `uuid` columns reject mock ids like `t-8`; treat those as local-only rows.
 * Permissive on UUID version — seed/test restaurants use non-v4 UUIDs
 * (e.g. `a1000006-1111-1111-1111-000000000006`) but are still legitimate DB rows.
 * The DB only validates the 8-4-4-4-12 hex shape, so we mirror that here.
 * Matches the `Uuid` schema in `supabase/functions/_shared/validation/base.ts`.
 */
export function isDatabaseUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

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

  const fetchAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;

      if (!selectedRestaurantId || !isSupabaseConfigured()) {
        setTables([]);
        setFloorPlans([]);
        setSections([]);
        setLoading(false);
        return;
      }

      const seq = ++fetchSeqRef.current;
      if (!silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const bundle = await fetchFloorPlanBundle(selectedRestaurantId);
        if (seq !== fetchSeqRef.current) return;

        if (bundle.error) {
          const friendly = toUserFacingError(bundle.error, "Couldn't load floor plan.");
          setError(new Error(friendly.message));
          console.error("[useFloorPlan.load]", friendly.code, friendly.technical ?? bundle.error);
        } else {
          setError(null);
          writeFloorPlanCache(selectedRestaurantId, bundle);
        }

        setTables(bundle.tables);
        setFloorPlans(bundle.floorPlans);
        setSections(bundle.sections);
      } catch (e) {
        if (seq !== fetchSeqRef.current) return;
        const friendly = toUserFacingError(e, "Couldn't load floor plan.");
        setError(new Error(friendly.message));
        console.error("[useFloorPlan.load]", friendly.code, friendly.technical ?? e);
        if (!silent) {
          setTables([]);
          setFloorPlans([]);
          setSections([]);
        }
      } finally {
        if (seq === fetchSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [selectedRestaurantId],
  );

  const refetch = useCallback(
    (opts?: { silent?: boolean }) => fetchAll({ silent: opts?.silent ?? false }),
    [fetchAll],
  );

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
        const friendly = toUserFacingError(sectionRes.error, "Couldn't create the floor.");
        setError(new Error(friendly.message));
        console.error("[useFloorPlan.createSection]", friendly.code, friendly.technical ?? sectionRes.error);
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
        const friendly = toUserFacingError(floorPlanRes.error, "Couldn't create the floor layout.");
        setError(new Error(friendly.message));
        console.error("[useFloorPlan.createFloor]", friendly.code, friendly.technical ?? floorPlanRes.error);
        return null;
      }

      await fetchAll({ silent: true });
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
        const friendly = toUserFacingError(res.error, "Couldn't add the table.");
        setError(new Error(friendly.message));
        console.error("[useFloorPlan.createTable]", friendly.code, friendly.technical ?? res.error);
        return null;
      }
      return res.data as TableRow;
    },
    [sections, selectedRestaurantId, tables],
  );

  const updateFloorName = useCallback(
    async (sectionId: string, name: string): Promise<boolean> => {
      const trimmedName = name.trim();
      if (!trimmedName) return false;
      if (!isDatabaseUuid(sectionId)) return true;
      if (!isSupabaseConfigured()) return false;

      const client = getSupabaseBrowserClient();
      const sectionRes = await client
        .from("restaurant_sections")
        .update({ name: trimmedName })
        .eq("id", sectionId);
      if (sectionRes.error) {
        const friendly = toUserFacingError(sectionRes.error, "Couldn't rename the floor.");
        setError(new Error(friendly.message));
        console.error("[useFloorPlan.updateFloorName.section]", friendly.code, friendly.technical ?? sectionRes.error);
        return false;
      }

      const planRes = await client
        .from("floor_plans")
        .update({ name: trimmedName })
        .eq("section_id", sectionId);
      if (planRes.error) {
        const friendly = toUserFacingError(planRes.error, "Couldn't rename the floor layout.");
        setError(new Error(friendly.message));
        console.error("[useFloorPlan.updateFloorName.plan]", friendly.code, friendly.technical ?? planRes.error);
        return false;
      }

      return true;
    },
    [],
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
    if (sanitized.status === "empty") {
      const { data: activeLinks } = await client
        .from("reservation_tables")
        .select("reservation_id, reservations(status)")
        .eq("table_id", tableId)
        .is("released_at", null);
      const reservationIds = ((activeLinks ?? []) as Array<{ reservation_id: string; reservations?: { status?: string } | null }>)
        .filter((link) => ["seated", "completed", "cancelled", "no_show"].includes(link.reservations?.status ?? ""))
        .map((link) => link.reservation_id);
      for (const reservationId of reservationIds) {
        await releaseReservationTables(reservationId);
      }
    }
    const res = await client.from("tables").update(sanitized).eq("id", tableId);
    if (res.error) {
      const friendly = toUserFacingError(res.error, "Couldn't update the table.");
      setError(new Error(friendly.message));
      console.error("[useFloorPlan.updateTable]", friendly.code, friendly.technical ?? res.error);
      return false;
    }
    return true;
  }, []);

  const updateTableServiceStatus = useCallback(
    async (tableId: string, status: string, seatedCount: number): Promise<boolean> => {
      if (!isDatabaseUuid(tableId)) {
        setTables((prev) =>
          prev.map((table) =>
            table.id === tableId
              ? { ...table, status, seated_count: Math.max(0, seatedCount) }
              : table,
          ),
        );
        setError(null);
        return true;
      }
      if (!isSupabaseConfigured()) return false;

      const client = getSupabaseBrowserClient();
      const { error } = await client.rpc("update_table_service_status", {
        p_table_id: tableId,
        p_status: status,
        p_seated_count: Math.max(0, seatedCount),
      });

      if (error) {
        const friendly = toUserFacingError(error, "Couldn't update the table status.");
        setError(new Error(friendly.message));
        console.error("[useFloorPlan.updateTableServiceStatus]", friendly.code, friendly.technical ?? error);
        return false;
      }
      return true;
    },
    [],
  );

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
      const friendly = toUserFacingError(res.error, "Couldn't delete the table.");
      setError(new Error(friendly.message));
      console.error("[useFloorPlan.deleteTable]", friendly.code, friendly.technical ?? res.error);
      return false;
    }
    if (refetchAfter) await fetchAll({ silent: true });
    return true;
  }, [fetchAll]);

  const deleteFloor = useCallback(
    async (sectionId: string, options?: { refetchAfter?: boolean }): Promise<boolean> => {
      const refetchAfter = options?.refetchAfter ?? true;
      if (!isDatabaseUuid(sectionId)) {
        setTables((prev) => prev.filter((table) => table.section_id !== sectionId));
        setFloorPlans((prev) => prev.filter((plan) => plan.section_id !== sectionId && plan.id !== sectionId));
        setSections((prev) => prev.filter((section) => section.id !== sectionId));
        setError(null);
        return true;
      }
      if (!isSupabaseConfigured()) return false;

      const client = getSupabaseBrowserClient();
      const [tablesRes, plansRes, sectionRes] = await Promise.all([
        client.from("tables").update({ is_active: false }).eq("section_id", sectionId),
        client.from("floor_plans").update({ is_active: false }).eq("section_id", sectionId),
        client.from("restaurant_sections").update({ is_active: false }).eq("id", sectionId),
      ]);

      const error = tablesRes.error ?? plansRes.error ?? sectionRes.error;
      if (error) {
        const friendly = toUserFacingError(error, "Couldn't delete the floor.");
        setError(new Error(friendly.message));
        console.error("[useFloorPlan.deleteFloor]", friendly.code, friendly.technical ?? error);
        return false;
      }

      if (refetchAfter) await fetchAll({ silent: true });
      return true;
    },
    [fetchAll],
  );

  const updateLayout = useCallback(async (floorPlanId: string, layout: FloorPlanLayout) => {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const res = await client.from("floor_plans").update({ layout }).eq("id", floorPlanId);
    if (res.error) {
      const friendly = toUserFacingError(res.error, "Couldn't save the layout.");
      setError(new Error(friendly.message));
      console.error("[useFloorPlan.updateLayout]", friendly.code, friendly.technical ?? res.error);
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setTables([]);
        setFloorPlans([]);
        setSections([]);
        setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }

    const cached = readFloorPlanCache(selectedRestaurantId);
    if (cached && !cached.error) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setTables(cached.tables);
        setFloorPlans(cached.floorPlans);
        setSections(cached.sections);
        setError(null);
        setLoading(false);
        void fetchAll({ silent: true });
      });
    } else {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setTables([]);
        setFloorPlans([]);
        setSections([]);
        void fetchAll({ silent: false });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedRestaurantId, fetchAll]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured() || pauseRealtime) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`tables:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tables", filter: `restaurant_id=eq.${selectedRestaurantId}` },
        () => { void fetchAll({ silent: true }); },
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
    refetch,
    createSectionAndFloor,
    createTable,
    updateFloorName,
    updateTable,
    updateTableServiceStatus,
    deleteTable,
    deleteFloor,
    updateLayout,
  };
}
