"use client";

export function FeaturesWaitlistMockup() {
  return (
    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
      <p className="mb-md text-xs font-medium text-text-muted-on-dark">
        Waitlist
      </p>
      <div className="space-y-sm">
        {[
          { name: "Chen", party: 4, wait: "~15 min" },
          { name: "Williams", party: 2, wait: "~8 min" },
          { name: "Lee", party: 3, wait: "~25 min" },
        ].map((entry) => (
          <div
            key={entry.name}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-text-on-dark">
              {entry.name}, party of {entry.party}
            </span>
            <span className="text-text-muted-on-dark">{entry.wait}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
