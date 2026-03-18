export function HowItWorksPhoneMockup() {
  return (
    <div className="mx-auto w-full max-w-[200px]">
      <div className="overflow-hidden rounded-2xl border border-border-card bg-surface-dark">
        <div className="mx-1 mt-4 mb-1 rounded-xl bg-surface-dark-elevated p-md">
          <div className="space-y-md">
            <div className="flex items-center gap-sm">
              <div className="h-2 w-2 rounded-full bg-gold" />
              <span className="text-xs text-text-on-dark">Select date</span>
            </div>
            <div className="flex items-center gap-sm">
              <div className="h-2 w-2 rounded-full bg-gold" />
              <span className="text-xs text-text-muted-on-dark">Choose time</span>
            </div>
            <div className="flex items-center gap-sm">
              <div className="h-2 w-2 rounded-full bg-border-dark" />
              <span className="text-xs text-text-muted-on-dark">Confirm</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
