import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

import { TablesListEditor } from "./TablesListEditor";
import { STARTER_TABLES, type WizardTable, type WizardTableShape } from "./wizardTypes";

type Step3FloorPlanProps = {
  restaurantId: string;
  initial: WizardTable[] | null;
  onComplete: (tables: WizardTable[]) => void;
  onBusyChange: (busy: boolean) => void;
};

type ExistingTableRow = {
  id: string;
  label: string | null;
  table_number: string | null;
  capacity: number;
  shape: string | null;
};

function toShape(value: string | null): WizardTableShape {
  if (value === "round" || value === "square" || value === "rectangle" || value === "booth") {
    return value;
  }
  if (value === "circle") return "round";
  return "round";
}

export function Step3FloorPlan({ restaurantId, initial, onComplete, onBusyChange }: Step3FloorPlanProps) {
  const [tables, setTables] = useState<WizardTable[]>(initial ?? STARTER_TABLES);
  const [hydrated, setHydrated] = useState(initial !== null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    void (async () => {
      if (!isSupabaseConfigured()) {
        setHydrated(true);
        return;
      }
      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from("tables")
        .select("id, label, table_number, capacity, shape")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true);
      if (cancelled) return;
      const rows = (data ?? []) as ExistingTableRow[];
      if (rows.length > 0) {
        setTables(
          rows.map((row, idx) => ({
            id: row.id,
            label: row.label ?? row.table_number ?? `T${idx + 1}`,
            capacity: Math.max(1, row.capacity),
            shape: toShape(row.shape),
          })),
        );
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, restaurantId]);

  const onSubmit = async () => {
    if (tables.length === 0) {
      toast.error("Add at least one table.");
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    onBusyChange(true);
    try {
      const client = getSupabaseBrowserClient();

      const { error: deactivateErr } = await client
        .from("tables")
        .update({ is_active: false })
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true);
      if (deactivateErr) {
        toast.error(deactivateErr.message);
        return;
      }

      const rows = tables.map((t, idx) => ({
        restaurant_id: restaurantId,
        table_number: t.label || `T${idx + 1}`,
        label: t.label || `T${idx + 1}`,
        capacity: t.capacity,
        shape: t.shape,
        position_x: 0,
        position_y: 0,
        is_active: true,
      }));

      const { error: insertErr } = await client.from("tables").insert(rows);
      if (insertErr) {
        toast.error(insertErr.message);
        return;
      }

      onComplete(tables);
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Configure your tables</h1>
        <p className="mt-1 text-sm text-text-muted">
          A starter set is pre-filled — adjust capacities, add or remove tables to match your floor.
        </p>
      </div>

      <TablesListEditor value={tables} onChange={setTables} />

      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{tables.length} table{tables.length === 1 ? "" : "s"}</span>
        <Button id="wizard-step-submit" onClick={onSubmit} disabled={submitting || tables.length === 0} className="px-6">
          {submitting ? "Saving…" : "Continue to booking rules"}
        </Button>
      </div>
    </div>
  );
}
