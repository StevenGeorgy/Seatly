import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { getStatusColor } from "@/lib/canvas-colors";

import type { HoveredTableInfo } from "./types";
import { tableFloorPlanTitle } from "./table-title";

type TableTooltipProps = {
  info: HoveredTableInfo | null;
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  empty: "dashboard.floorPlan.statusEmpty",
  reserved: "dashboard.floorPlan.statusReserved",
  occupied: "dashboard.floorPlan.statusOccupied",
  cleaning: "dashboard.floorPlan.statusCleaning",
  blocked: "dashboard.floorPlan.statusBlocked",
};

export function TableTooltip({ info }: TableTooltipProps) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {info && (
        <motion.div
          key={info.table.id}
          initial={{ opacity: 0, scale: 0.92, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 4 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="pointer-events-none fixed z-50 min-w-[160px] rounded-lg border border-border bg-bg-elevated px-3 py-2 shadow-xl shadow-black/40"
          style={{
            left: info.screenX + 16,
            top: info.screenY - 8,
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: getStatusColor(info.table.status) }}
            />
            <span className="text-sm font-semibold text-text-primary">
              {tableFloorPlanTitle(t, info.table)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-text-secondary">
            <span>
              {t("dashboard.floorPlan.capacity")}: {info.table.capacity ?? 0}
            </span>
            <span>
              {t(STATUS_LABEL_KEYS[info.table.status] ?? "dashboard.floorPlan.statusEmpty")}
            </span>
          </div>
          {info.table.notes && (
            <div className="mt-1 text-xs text-text-muted">{info.table.notes}</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
