"use client";

import { SectionWithFade } from "./SectionWithFade";
import { LandingSectionLabel } from "./LandingSectionLabel";
import { LandingCardStagger } from "./LandingCardStagger";
import { FeatureCardPreview } from "./FeatureCardPreview";

const FEATURES = [
  {
    title: "Live Floor Plan",
    description:
      "Real-time table status, colour-coded by state. Tap any table to see the guest card and take action.",
    icon: FloorPlanIcon,
    preview: "floor-plan" as const,
  },
  {
    title: "Guest CRM with AI",
    description:
      "Full history, preferences, and AI-generated insights. Every guest becomes a permanent profile.",
    icon: CrmIcon,
    preview: "crm" as const,
  },
  {
    title: "Pre-Orders and Arrival",
    description: "Guests pre-order from the mobile app. Kitchen is ready when they arrive.",
    icon: PreOrderIcon,
    preview: "pre-orders" as const,
  },
  {
    title: "Smart Waitlist",
    description:
      "Walk-ins join remotely, get notified when a table is ready. No more crowded lobbies.",
    icon: WaitlistIcon,
    preview: "waitlist" as const,
  },
  {
    title: "Analytics Dashboard",
    description:
      "Revenue, covers, no-show rate, top dishes. Know your business inside and out.",
    icon: AnalyticsIcon,
    preview: "analytics" as const,
  },
  {
    title: "Voice AI Receptionist",
    description:
      "VAPI answers calls 24/7, takes bookings, and never misses a reservation.",
    icon: VoiceIcon,
    preview: "voice-ai" as const,
  },
];

function FloorPlanIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  );
}

function CrmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function PreOrderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
    </svg>
  );
}

function WaitlistIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

function AnalyticsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function VoiceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
    </svg>
  );
}

export function LandingFeatures() {
  return (
    <SectionWithFade id="features" className="bg-background-dark py-20 lg:py-32">
      <div className="mx-auto max-w-6xl px-xl">
        <div className="mb-3xl flex flex-col items-center text-center">
          <LandingSectionLabel>Everything you need</LandingSectionLabel>
          <h2 className="text-4xl font-semibold tracking-tight-section text-text-on-dark">
            Run a modern restaurant
          </h2>
        </div>
        <LandingCardStagger
          className="grid gap-xl sm:grid-cols-2 lg:grid-cols-3"
          staggerDelayMs={100}
        >
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group relative overflow-hidden rounded-lg border border-border-card bg-surface-dark p-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all duration-400 hover:border-gold/50 hover:shadow-gold-glow-hover"
              >
                <div className="absolute left-0 right-0 top-0 h-24 bg-gold-gradient-card-top opacity-0 transition-opacity duration-400 group-hover:opacity-100" />
                <div className="relative">
                  <div className="mb-md text-gold">
                    <Icon className="h-10 w-10" />
                  </div>
                  <h3 className="mb-sm text-lg font-semibold text-text-on-dark">
                    {feature.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-text-muted-on-dark">
                    {feature.description}
                  </p>
                  <a
                    href="#"
                    className="mt-lg inline-block text-sm text-gold/80 transition-colors hover:text-gold"
                  >
                    Learn more →
                  </a>
                  <FeatureCardPreview type={feature.preview} />
                </div>
              </div>
            );
          })}
        </LandingCardStagger>
      </div>
    </SectionWithFade>
  );
}
