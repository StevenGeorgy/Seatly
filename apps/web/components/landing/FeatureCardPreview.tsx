"use client";

interface FeatureCardPreviewProps {
  type:
    | "floor-plan"
    | "crm"
    | "pre-orders"
    | "waitlist"
    | "analytics"
    | "voice-ai";
}

export function FeatureCardPreview({ type }: FeatureCardPreviewProps) {
  if (type === "floor-plan") {
    return (
      <div className="mt-lg flex max-h-[120px] items-center justify-center rounded-md border border-border-card bg-surface-dark-elevated p-md">
        <div className="grid grid-cols-4 gap-1.5">
          {["table-empty", "table-seated", "table-arriving", "table-overdue"].map(
            (color) => (
              <div
                key={color}
                className={`h-6 w-6 rounded-full ${
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
          {["table-seated", "table-empty", "table-overdue", "table-arriving"].map(
            (color, i) => (
              <div
                key={i}
                className={`h-6 w-6 rounded-full ${
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
        </div>
      </div>
    );
  }

  if (type === "crm") {
    return (
      <div className="mt-lg flex h-[100px] items-center rounded-md border border-border-card bg-surface-dark-elevated p-md">
        <div className="flex items-center gap-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/20 text-xs font-semibold text-gold">
            JM
          </div>
          <div>
            <p className="text-sm font-medium text-text-on-dark">James M.</p>
            <p className="text-xs text-text-muted-on-dark">12 visits</p>
            <div className="mt-xs flex gap-xs">
              <span className="rounded px-xs py-0.5 text-[10px] text-gold ring-1 ring-gold/50">
                VIP
              </span>
              <span className="rounded px-xs py-0.5 text-[10px] text-text-muted-on-dark ring-1 ring-border-dark">
                Allergy
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "pre-orders") {
    return (
      <div className="mt-lg flex max-h-[120px] flex-col justify-center rounded-md border border-border-card bg-surface-dark-elevated p-md">
        <div className="flex items-center justify-between gap-sm">
          <span className="text-xs text-text-on-dark">Caesar salad</span>
          <span className="text-gold">✓</span>
        </div>
        <div className="mt-xs flex items-center justify-between gap-sm">
          <span className="text-xs text-text-on-dark">Ribeye</span>
          <span className="text-gold">✓</span>
        </div>
        <div className="mt-xs flex items-center justify-between gap-sm">
          <span className="text-xs text-text-muted-on-dark">Tiramisu</span>
          <span className="text-text-muted-on-dark">—</span>
        </div>
      </div>
    );
  }

  if (type === "waitlist") {
    return (
      <div className="mt-lg flex max-h-[120px] flex-col justify-center rounded-md border border-border-card bg-surface-dark-elevated p-md">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-on-dark">Chen, party of 4</span>
          <span className="text-text-muted-on-dark">~15 min</span>
        </div>
        <div className="mt-xs flex items-center justify-between text-xs">
          <span className="text-text-on-dark">Williams, 2</span>
          <span className="text-text-muted-on-dark">~8 min</span>
        </div>
        <div className="mt-xs flex items-center justify-between text-xs">
          <span className="text-text-muted-on-dark">Lee, 3</span>
          <span className="text-text-muted-on-dark">~25 min</span>
        </div>
      </div>
    );
  }

  if (type === "analytics") {
    return (
      <div className="mt-lg flex h-[100px] items-end justify-center gap-1 rounded-md border border-border-card bg-surface-dark-elevated p-md">
        {[40, 65, 45, 80, 55].map((h, i) => (
          <div
            key={i}
            className="w-4 rounded-t bg-gold"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    );
  }

  if (type === "voice-ai") {
    return (
      <div className="mt-lg flex max-h-[120px] items-center justify-center gap-1 rounded-md border border-border-card bg-surface-dark-elevated p-md">
        {[0.3, 0.7, 0.4, 0.9, 0.5, 0.6, 0.35].map((_, i) => (
          <div
            key={i}
            className="h-6 w-1.5 origin-bottom animate-waveform rounded-full bg-gold"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    );
  }

  return null;
}
