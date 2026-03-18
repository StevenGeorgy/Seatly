"use client";

export function FeaturesAnalyticsMockup() {
  return (
    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
      <p className="mb-md text-xs font-medium text-text-muted-on-dark">
        Revenue by day
      </p>
      <div className="flex items-end justify-between gap-sm">
        {[40, 65, 45, 80, 55, 70, 90].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-gold/80"
            style={{ height: `${h}%`, minHeight: "24px" }}
          />
        ))}
      </div>
      <div className="mt-sm flex justify-between text-[10px] text-text-muted-on-dark">
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
        <span>Sun</span>
      </div>
    </div>
  );
}
