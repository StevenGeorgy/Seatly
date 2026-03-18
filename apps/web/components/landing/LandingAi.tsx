"use client";

import { SectionWithFade } from "./SectionWithFade";
import { LandingSectionLabel } from "./LandingSectionLabel";
import { LandingGlassCard } from "./LandingGlassCard";
import { LandingCardStagger } from "./LandingCardStagger";
import { LandingAiChatDemo } from "./LandingAiChatDemo";

const AI_FEATURES = [
  {
    title: "Guest Intelligence",
    description:
      "Every guest builds a permanent profile. AI tracks preferences, spend patterns, and dining history automatically.",
  },
  {
    title: "Nightly Shift Briefing",
    description:
      "Before every service, AI generates a full briefing — VIPs arriving, allergy alerts, no-show risks, and table recommendations.",
  },
  {
    title: "No-Show Prediction",
    description:
      "AI scores every reservation 0-100 for no-show risk so your host can act before it happens.",
  },
  {
    title: "Natural Language CRM",
    description:
      "Ask your guest database anything. Who are my top spenders this month? Which regulars haven't visited in 60 days?",
  },
];

export function LandingAi() {
  return (
    <SectionWithFade
      id="ai"
      className="relative overflow-hidden border-t border-border-dark/50 bg-surface-dark-alt py-20 lg:py-32"
    >
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 bg-gold-glow-section bg-no-repeat" />

      <div className="relative mx-auto max-w-6xl px-xl">
        <div className="mb-3xl flex flex-col items-center text-center">
          <div className="mb-md flex items-center gap-sm">
            <LandingSectionLabel>AI</LandingSectionLabel>
            <span
              className="h-2 w-2 animate-pulse rounded-full bg-gold"
              aria-hidden
            />
          </div>
          <h2 className="text-4xl font-semibold tracking-tight-section text-text-on-dark">
            AI That Gets Smarter Every Shift
          </h2>
          <p className="mx-auto mt-lg max-w-2xl leading-relaxed text-text-muted-on-dark">
            Seatly learns from every visit, every order, and every guest interaction —
            so your team always knows exactly who is walking in the door
          </p>
        </div>

        <div className="flex flex-col gap-3xl lg:flex-row lg:items-start">
          {/* Left: AI feature cards */}
          <div className="flex-1">
            <LandingCardStagger
              className="grid gap-xl sm:grid-cols-2"
              staggerDelayMs={100}
            >
              {AI_FEATURES.map((feature) => (
                <LandingGlassCard
                  key={feature.title}
                  className="bg-gradient-to-b from-transparent to-white/[0.02]"
                >
                  <h3 className="mb-sm text-lg font-semibold text-text-on-dark">
                    {feature.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-text-muted-on-dark">
                    {feature.description}
                  </p>
                </LandingGlassCard>
              ))}
            </LandingCardStagger>
          </div>

          {/* Right: Chat demo */}
          <div className="w-full lg:w-[400px] lg:flex-shrink-0">
            <LandingAiChatDemo />
          </div>
        </div>
      </div>
    </SectionWithFade>
  );
}
