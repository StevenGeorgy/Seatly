"use client";

export function FeaturesPreOrdersMockup() {
  return (
    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
      <p className="mb-md text-xs font-medium text-text-muted-on-dark">
        Table 4 · 7:30 PM
      </p>
      <div className="space-y-sm">
        {["Caesar salad", "Ribeye medium", "Tiramisu"].map((dish, i) => (
          <div
            key={dish}
            className="flex items-center justify-between text-sm"
          >
            <span
              className={
                i < 2 ? "text-text-on-dark" : "text-text-muted-on-dark"
              }
            >
              {dish}
            </span>
            {i < 2 ? (
              <span className="text-gold">✓</span>
            ) : (
              <span className="text-text-muted-on-dark">—</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
