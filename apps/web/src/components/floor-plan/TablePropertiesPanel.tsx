import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { zodResolver } from "@hookform/resolvers/zod";
import { Minus, Plus, Trash2 } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SectionRow, TableRow } from "@/hooks/useFloorPlan";

// ─── Schema ──────────────────────────────────────────────────────────────────

const schema = z.object({
  table_number: z.string().min(1),
  label: z.string(),
  shape: z.enum(["rectangle", "circle", "square"]),
  capacity: z.number().int().min(1).max(20),
  min_party: z.number().int().min(1).max(20),
  section_id: z.string(),
  status: z.enum(["empty", "reserved", "occupied", "cleaning", "blocked"]),
  notes: z.string(),
});

type FormValues = z.infer<typeof schema>;

// ─── Props ────────────────────────────────────────────────────────────────────

type TablePropertiesPanelProps = {
  table: TableRow;
  sections: SectionRow[];
  onPatch: (id: string, patch: Partial<TableRow>) => void;
  onDelete: (id: string) => void;
};

function toFormValues(table: TableRow): FormValues {
  return {
    table_number: table.table_number ?? "",
    label: table.label ?? "",
    shape: (table.shape as "rectangle" | "circle" | "square") ?? "rectangle",
    capacity: table.capacity ?? 4,
    min_party: table.min_party ?? 1,
    section_id: table.section_id ?? "",
    status: (table.status as FormValues["status"]) ?? "empty",
    notes: table.notes ?? "",
  };
}

function formValuesEqual(a: FormValues, b: FormValues): boolean {
  return (
    a.table_number === b.table_number &&
    a.label === b.label &&
    a.shape === b.shape &&
    a.capacity === b.capacity &&
    a.min_party === b.min_party &&
    a.section_id === b.section_id &&
    a.status === b.status &&
    a.notes === b.notes
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TablePropertiesPanel({
  table,
  sections,
  onPatch,
  onDelete,
}: TablePropertiesPanelProps) {
  const { t } = useTranslation();

  const { register, watch, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(table),
  });

  // Track the last table id we synced from so reset only fires on actual table switch.
  const syncedTableIdRef = useRef(table.id);
  // Guard to skip the watch→onPatch cycle during programmatic resets.
  const isResettingRef = useRef(false);
  // Track last values we patched to avoid redundant patches.
  const lastPatchedRef = useRef<FormValues>(toFormValues(table));

  useEffect(() => {
    if (syncedTableIdRef.current !== table.id) {
      syncedTableIdRef.current = table.id;
      const next = toFormValues(table);
      isResettingRef.current = true;
      reset(next);
      lastPatchedRef.current = next;
      // Release the guard after React flushes the form state update.
      requestAnimationFrame(() => {
        isResettingRef.current = false;
      });
    }
  }, [table.id, reset, table]);

  // Patch parent on user-initiated field changes only.
  const values = watch();
  useEffect(() => {
    if (isResettingRef.current) return;
    if (formValuesEqual(values, lastPatchedRef.current)) return;
    lastPatchedRef.current = { ...values };
    const trimmedNumber = values.table_number.trim();
    // DB column `table_number` is NOT NULL — never send null or empty.
    const tableNumber =
      trimmedNumber.length > 0 ? trimmedNumber : (table.table_number?.trim() || "T");
    onPatch(table.id, {
      table_number: tableNumber,
      label: values.label || null,
      shape: values.shape,
      capacity: values.capacity,
      min_party: values.min_party,
      section_id: values.section_id || null,
      status: values.status,
      notes: values.notes || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.table_number, values.label, values.shape, values.capacity, values.min_party, values.section_id, values.status, values.notes]);

  const capacity = watch("capacity");
  const minParty = watch("min_party");

  return (
    <div className="flex h-full w-72 shrink-0 flex-col gap-0 overflow-y-auto border-l border-border bg-bg-surface">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          {t("dashboard.floorPlan.tableProperties")}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* Table Number */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-text-secondary">{t("dashboard.floorPlan.tableNumber")}</Label>
          <Input
            {...register("table_number")}
            className="h-9"
            aria-invalid={!!errors.table_number}
          />
        </div>

        {/* Label */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-text-secondary">{t("dashboard.floorPlan.tableLabel")}</Label>
          <Input {...register("label")} className="h-9" />
        </div>

        {/* Shape segmented control */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-text-secondary">{t("dashboard.floorPlan.shape")}</Label>
          <div className="grid grid-cols-3 gap-1">
            {(["rectangle", "circle", "square"] as const).map((s) => {
              const active = watch("shape") === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setValue("shape", s)}
                  className={[
                    "rounded-md py-1.5 text-xs font-medium capitalize transition-colors",
                    active
                      ? "bg-gold text-bg-base"
                      : "border border-border bg-bg-elevated text-text-secondary hover:text-text-primary",
                  ].join(" ")}
                >
                  {t(`dashboard.floorPlan.shape${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Capacity */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-text-secondary">{t("dashboard.floorPlan.capacity")}</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setValue("capacity", Math.max(1, capacity - 1))}
            >
              <Minus className="size-3.5" />
            </Button>
            <span className="w-8 text-center text-sm font-medium tabular-nums text-text-primary">
              {capacity}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setValue("capacity", Math.min(20, capacity + 1))}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Min Party */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-text-secondary">{t("dashboard.floorPlan.minParty")}</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setValue("min_party", Math.max(1, minParty - 1))}
            >
              <Minus className="size-3.5" />
            </Button>
            <span className="w-8 text-center text-sm font-medium tabular-nums text-text-primary">
              {minParty}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => setValue("min_party", Math.min(20, minParty + 1))}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Section */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-text-secondary">{t("dashboard.floorPlan.section")}</Label>
          <Select
            value={watch("section_id")}
            onValueChange={(v) => setValue("section_id", v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {sections.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-text-secondary">{t("dashboard.reservations.status")}</Label>
          <Select
            value={watch("status")}
            onValueChange={(v) => setValue("status", v as FormValues["status"])}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["empty", "reserved", "occupied", "cleaning", "blocked"] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`dashboard.floorPlan.status${s.charAt(0).toUpperCase() + s.slice(1)}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-text-secondary">{t("dashboard.floorPlan.notes")}</Label>
          <Textarea {...register("notes")} className="min-h-16 resize-none" />
        </div>
      </div>

      {/* Delete */}
      <div className="mt-auto border-t border-border px-4 py-3">
        <Button
          variant="destructive"
          className="w-full gap-2"
          onClick={() => onDelete(table.id)}
        >
          <Trash2 className="size-4" />
          {t("dashboard.floorPlan.deleteTable")}
        </Button>
      </div>
    </div>
  );
}
