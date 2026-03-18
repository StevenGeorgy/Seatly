export function HowItWorksDashboardMockup() {
  return (
    <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-lg border border-border-card bg-surface-dark">
      <div className="flex">
        <aside className="w-16 border-r border-border-dark bg-surface-dark-elevated py-sm">
          <div className="space-y-xs px-sm">
            <div className="rounded bg-gold/10 px-xs py-xs text-center">
              <span className="text-[10px] font-medium text-gold">Floor</span>
            </div>
            <div className="rounded px-xs py-xs text-center">
              <span className="text-[10px] text-text-muted-on-dark">CRM</span>
            </div>
            <div className="rounded px-xs py-xs text-center">
              <span className="text-[10px] text-text-muted-on-dark">Orders</span>
            </div>
          </div>
        </aside>
        <main className="flex-1 p-sm">
          <div className="mb-sm grid grid-cols-2 gap-xs">
            <div className="rounded border border-gold/30 bg-gold-tint px-xs py-xs">
              <p className="text-[9px] text-text-muted-on-dark">Covers</p>
              <p className="text-sm font-bold text-gold">42</p>
            </div>
            <div className="rounded border border-border-card bg-surface-dark-elevated px-xs py-xs">
              <p className="text-[9px] text-text-muted-on-dark">Revenue</p>
              <p className="text-sm font-bold text-text-on-dark">$2.4k</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {["table-seated", "table-empty", "table-arriving", "table-overdue"].map(
              (color) => (
                <div
                  key={color}
                  className={`aspect-square rounded-full ${
                    color === "table-empty"
                      ? "bg-table-empty"
                      : color === "table-seated"
                        ? "bg-table-seated"
                        : color === "table-arriving"
                          ? "bg-table-arriving"
                          : "bg-table-overdue"
                  }`}
                />
              )
            )}
            {["table-empty", "table-seated", "table-seated", "table-empty"].map(
              (color, i) => (
                <div
                  key={i}
                  className={`aspect-square rounded-full ${
                    color === "table-empty" ? "bg-table-empty" : "bg-table-seated"
                  }`}
                />
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
