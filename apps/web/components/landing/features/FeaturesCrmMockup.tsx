"use client";

export function FeaturesCrmMockup() {
  return (
    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
      <div className="flex items-start gap-md">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/20 text-sm font-semibold text-gold">
          JM
        </div>
        <div>
          <p className="font-medium text-text-on-dark">James Martinez</p>
          <p className="mt-xs text-sm text-text-muted-on-dark">24 visits · $4.2k lifetime</p>
          <div className="mt-md flex flex-wrap gap-xs">
            <span className="rounded px-sm py-xs text-xs text-gold ring-1 ring-gold/50">
              VIP
            </span>
            <span className="rounded px-sm py-xs text-xs text-text-muted-on-dark ring-1 ring-border-dark">
              Nut allergy
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
