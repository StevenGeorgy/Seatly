export function HowItWorksAiBriefingMockup() {
  return (
    <div className="mx-auto w-full max-w-[260px] overflow-hidden rounded-lg border border-border-card bg-surface-dark p-md">
      <div className="mb-sm flex items-center gap-xs">
        <span className="rounded bg-gold/20 px-xs py-0.5 text-[10px] font-medium text-gold">
          AI
        </span>
        <span className="text-xs font-semibold text-text-on-dark">Shift briefing</span>
      </div>
      <ul className="space-y-xs text-xs text-text-muted-on-dark">
        <li className="flex items-start gap-xs">
          <span className="text-gold">•</span>
          <span>3 VIPs arriving tonight</span>
        </li>
        <li className="flex items-start gap-xs">
          <span className="text-gold">•</span>
          <span>2 allergy alerts on book</span>
        </li>
        <li className="flex items-start gap-xs">
          <span className="text-gold">•</span>
          <span>Table 7 — no-show risk 72%</span>
        </li>
      </ul>
    </div>
  );
}
