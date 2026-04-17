import { useMemo, useState } from "react";
import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFloorPlan } from "@/hooks/useFloorPlan";
import type { ReservationRow } from "@/hooks/useReservations";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  empty: "Empty",
  occupied: "Occupied",
  reserved: "Reserved",
  cleaning: "Cleaning",
  blocked: "Blocked",
};

const STATUS_COLOR: Record<string, string> = {
  empty: "bg-success/10 text-success border-success/20",
  occupied: "bg-destructive/10 text-destructive border-destructive/20",
  reserved: "bg-warning/10 text-warning border-warning/20",
  cleaning: "bg-info/10 text-info border-info/20",
  blocked: "bg-muted/50 text-muted-foreground border-border",
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reservation: ReservationRow | null;
  onSeat: (tableId: string) => Promise<void>;
};

export function SeatReservationDialog({ open, onOpenChange, reservation, onSeat }: Props) {
  const { tables, sections, loading } = useFloorPlan({ pauseRealtime: false });
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const partySize = reservation?.party_size ?? 1;
  const guestName =
    reservation?.guests?.full_name ?? reservation?.guest_full_name ?? "Guest";

  const activeSections = useMemo(
    () => [...sections].sort((a, b) => a.sort_order - b.sort_order),
    [sections],
  );

  const [activeSection, setActiveSection] = useState<string>("");
  const sectionId =
    activeSection || activeSections[0]?.id || "";

  const tablesForSection = useMemo(
    () =>
      tables.filter(
        (t) => t.is_active && (activeSections.length === 0 || t.section_id === sectionId),
      ),
    [tables, sectionId, activeSections.length],
  );

  const handleConfirm = async () => {
    if (!selectedTableId) return;
    setSaving(true);
    try {
      await onSeat(selectedTableId);
      onOpenChange(false);
      setSelectedTableId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!saving) {
      if (!o) setSelectedTableId(null);
      onOpenChange(o);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4 text-gold" />
            Seat {guestName}
            <span className="ml-1 text-sm font-normal text-text-muted">
              · Party of {partySize}
            </span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-text-muted">
            Loading tables…
          </div>
        ) : tables.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-text-muted">
            No tables configured for this restaurant.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {activeSections.length > 1 && (
              <Tabs
                value={sectionId}
                onValueChange={(v) => {
                  setActiveSection(v);
                  setSelectedTableId(null);
                }}
              >
                <TabsList>
                  {activeSections.map((s) => (
                    <TabsTrigger key={s.id} value={s.id}>
                      {s.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {tablesForSection.map((table) => {
                const tooSmall = table.capacity < partySize;
                const unavailable = table.status !== "empty";
                const belowMin =
                  table.min_party != null && partySize < table.min_party;
                const disabled = tooSmall || unavailable;

                const tooltip = tooSmall
                  ? `Too small for party of ${partySize}`
                  : unavailable
                    ? `Table is ${STATUS_LABEL[table.status] ?? table.status}`
                    : "";

                const isSelected = selectedTableId === table.id;

                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={disabled}
                    title={tooltip}
                    onClick={() => setSelectedTableId(isSelected ? null : table.id)}
                    className={cn(
                      "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
                      disabled
                        ? "cursor-not-allowed border-border opacity-40"
                        : isSelected
                          ? "border-gold bg-gold/10 ring-1 ring-gold"
                          : "border-border bg-bg-elevated hover:border-gold/40 hover:bg-bg-elevated/80",
                    )}
                  >
                    <span className="text-sm font-semibold text-text-primary">
                      {table.label ?? table.table_number ?? "—"}
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant="outline"
                        className={cn(
                          "px-1.5 py-0 text-[10px]",
                          STATUS_COLOR[table.status] ?? STATUS_COLOR.blocked,
                        )}
                      >
                        {STATUS_LABEL[table.status] ?? table.status}
                      </Badge>
                      <span className="text-[10px] text-text-muted">
                        Seats {table.capacity}
                      </span>
                    </div>
                    {belowMin && !disabled && (
                      <span className="text-[10px] text-warning">
                        Min party {table.min_party}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={!selectedTableId || saving}
            onClick={() => void handleConfirm()}
          >
            {saving ? "Seating…" : "Confirm seat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
