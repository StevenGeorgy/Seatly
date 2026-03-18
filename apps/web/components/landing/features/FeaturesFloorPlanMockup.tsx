"use client";

const TABLES = [
  { id: 1, status: "empty" as const },
  { id: 2, status: "seated" as const },
  { id: 3, status: "arriving" as const },
  { id: 4, status: "empty" as const },
  { id: 5, status: "seated" as const },
  { id: 6, status: "overdue" as const },
  { id: 7, status: "reserved" as const },
  { id: 8, status: "empty" as const },
  { id: 9, status: "seated" as const },
];

function getTableClass(status: string) {
  const map: Record<string, string> = {
    empty: "bg-floor-plan-empty border-floor-plan-empty-border",
    seated: "bg-floor-plan-seated border-floor-plan-seated-border",
    arriving: "bg-floor-plan-arriving border-floor-plan-arriving-border",
    overdue: "bg-floor-plan-overdue border-floor-plan-overdue-border",
    reserved: "bg-floor-plan-reserved border-floor-plan-reserved-border",
  };
  return map[status] ?? map.empty;
}

export function FeaturesFloorPlanMockup() {
  return (
    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
      <p className="mb-md text-xs font-medium text-text-muted-on-dark">
        Live floor plan
      </p>
      <div className="grid grid-cols-3 gap-lg">
        {TABLES.map((t) => (
          <div key={t.id} className="flex flex-col items-center gap-xs">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full border-2 ${getTableClass(t.status)}`}
            >
              <span className="text-xs font-semibold text-text-on-dark">
                T{t.id}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
