"use client";

export function FeaturesAiBriefingMockup() {
  return (
    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
      <div className="mb-md flex items-center gap-sm">
        <span className="rounded-full border border-gold bg-gold/10 px-sm py-xs text-xs font-semibold text-gold">
          AI
        </span>
        <span className="text-sm font-medium text-text-on-dark">
          Nightly shift briefing
        </span>
      </div>
      <ul className="space-y-sm text-sm text-text-muted-on-dark">
        <li className="flex items-center gap-sm">
          <span className="text-gold">•</span>
          <span>3 VIPs arriving tonight</span>
        </li>
        <li className="flex items-center gap-sm">
          <span className="text-gold">•</span>
          <span>2 nut allergy alerts</span>
        </li>
        <li className="flex items-center gap-sm">
          <span className="text-gold">•</span>
          <span>1 high no-show risk (Table 7)</span>
        </li>
      </ul>
    </div>
  );
}
