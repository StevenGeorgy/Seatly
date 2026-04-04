import { useTranslation } from "react-i18next";

const STATUS_ENTRIES = [
  { key: "empty", dotClass: "bg-success" },
  { key: "reserved", dotClass: "bg-gold" },
  { key: "occupied", dotClass: "bg-danger" },
  { key: "cleaning", dotClass: "bg-cleaning" },
  { key: "blocked", dotClass: "bg-blocked" },
] as const;

const LABEL_KEYS: Record<string, string> = {
  empty: "dashboard.floorPlan.statusEmpty",
  reserved: "dashboard.floorPlan.statusReserved",
  occupied: "dashboard.floorPlan.statusOccupied",
  cleaning: "dashboard.floorPlan.statusCleaning",
  blocked: "dashboard.floorPlan.statusBlocked",
};

export function StatusLegend() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-bg-elevated/90 px-3 py-1.5 backdrop-blur-md">
      {STATUS_ENTRIES.map(({ key, dotClass }) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className={`size-2 shrink-0 rounded-full ${dotClass}`} />
          <span className="text-[10px] font-medium capitalize text-text-muted">
            {t(LABEL_KEYS[key] ?? key)}
          </span>
        </div>
      ))}
    </div>
  );
}
