"use client";

export function FeaturesVoiceAiMockup() {
  return (
    <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
      <div className="flex items-center gap-md">
        <span className="rounded-full border border-gold bg-gold/10 px-sm py-xs text-xs font-semibold text-gold">
          VAPI
        </span>
        <span className="text-sm text-text-muted-on-dark">
          Answering calls 24/7
        </span>
      </div>
      <div className="mt-md flex items-end justify-center gap-1">
        {[0.3, 0.7, 0.4, 0.9, 0.5, 0.6, 0.35].map((_, i) => (
          <div
            key={i}
            className="h-8 w-1.5 origin-bottom animate-waveform rounded-full bg-gold"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
}
