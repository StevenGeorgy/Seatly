import { useMemo } from "react";
import { Plus, Trash2, Circle, Square, RectangleHorizontal, Armchair } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardTable, WizardTableShape } from "./wizardTypes";

const SHAPES: { value: WizardTableShape; label: string; icon: typeof Circle }[] = [
  { value: "round", label: "Round", icon: Circle },
  { value: "square", label: "Square", icon: Square },
  { value: "rectangle", label: "Rectangle", icon: RectangleHorizontal },
  { value: "booth", label: "Booth", icon: Armchair },
];

type TablesListEditorProps = {
  value: WizardTable[];
  onChange: (next: WizardTable[]) => void;
  minTables?: number;
};

export function TablesListEditor({ value, onChange, minTables = 1 }: TablesListEditorProps) {
  const stats = useMemo(() => {
    const maxSingle = value.reduce((acc, t) => Math.max(acc, t.capacity), 0);
    const total = value.reduce((acc, t) => acc + t.capacity, 0);
    return { maxSingle, total };
  }, [value]);

  const addTable = () => {
    const nextNumber = value.length + 1;
    onChange([
      ...value,
      {
        id: `t-${Date.now()}-${nextNumber}`,
        label: `T${nextNumber}`,
        capacity: 2,
        shape: "round",
      },
    ]);
  };

  const updateTable = (id: string, patch: Partial<WizardTable>) => {
    onChange(value.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const removeTable = (id: string) => {
    if (value.length <= minTables) return;
    onChange(value.filter((t) => t.id !== id));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden grid-cols-[1fr_100px_1fr_36px] gap-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted sm:grid">
        <span>Label</span>
        <span>Capacity</span>
        <span>Shape</span>
        <span />
      </div>

      <div className="flex flex-col gap-2">
        {value.map((tb) => (
          <div
            key={tb.id}
            className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border bg-bg-surface px-3 py-3 sm:grid-cols-[1fr_100px_1fr_36px] sm:items-center sm:py-2.5"
          >
            <div className="flex flex-col gap-1 sm:contents">
              <Label className="text-[10px] uppercase text-text-muted sm:hidden">Label</Label>
              <Input
                value={tb.label}
                onChange={(e) => updateTable(tb.id, { label: e.target.value })}
                className="h-9"
              />
            </div>

            <div className="flex flex-col gap-1 sm:contents">
              <Label className="text-[10px] uppercase text-text-muted sm:hidden">Capacity</Label>
              <input
                type="number"
                min={1}
                max={30}
                value={tb.capacity}
                onChange={(e) =>
                  updateTable(tb.id, {
                    capacity: Math.max(1, Math.min(30, Number.parseInt(e.target.value, 10) || 1)),
                  })
                }
                className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text-primary outline-none focus:border-gold/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>

            <div className="col-span-2 flex flex-col gap-1 sm:col-span-1 sm:contents">
              <Label className="text-[10px] uppercase text-text-muted sm:hidden">Shape</Label>
              <div className="flex flex-wrap gap-1">
                {SHAPES.map((shape) => {
                  const Icon = shape.icon;
                  const active = tb.shape === shape.value;
                  return (
                    <button
                      key={shape.value}
                      type="button"
                      title={shape.label}
                      onClick={() => updateTable(tb.id, { shape: shape.value })}
                      className={`flex h-9 flex-1 min-w-[56px] items-center justify-center gap-1 rounded-md border px-2 text-xs transition-colors ${
                        active
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-border bg-bg-elevated text-text-muted hover:border-gold/30"
                      }`}
                    >
                      <Icon className="size-3.5" />
                      <span className="inline">{shape.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => removeTable(tb.id)}
              disabled={value.length <= minTables}
              className="col-start-2 row-start-1 flex size-8 shrink-0 items-center justify-center self-start rounded-lg text-text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 sm:col-start-auto sm:row-start-auto sm:self-center"
              aria-label="Remove table"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <Button type="button" onClick={addTable} variant="outline" className="gap-2 self-start">
        <Plus className="size-4" />
        Add table
      </Button>

      <div className="rounded-xl border border-border bg-bg-surface/60 p-4 text-sm text-text-secondary">
        Your floor seats parties of 1 to {Math.max(1, stats.maxSingle)} (largest table:{" "}
        {Math.max(1, stats.maxSingle)} seats, total: {stats.total} seats). Want to draw your floor
        plan visually? You can do that anytime in the Floor Plan tab after publishing.
      </div>
    </div>
  );
}
