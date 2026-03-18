"use client";

import { SectionWithFade } from "./SectionWithFade";
import { LandingSectionLabel } from "./LandingSectionLabel";
import { LandingCardStagger } from "./LandingCardStagger";
import { HowItWorksPhoneMockup } from "./HowItWorksPhoneMockup";
import { HowItWorksDashboardMockup } from "./HowItWorksDashboardMockup";
import { HowItWorksAiBriefingMockup } from "./HowItWorksAiBriefingMockup";

const STEPS = [
  {
    number: 1,
    title: "Guest books on the mobile app",
    description:
      "Customers reserve tables, pre-order food, and join the waitlist — all from their phone.",
    mockup: HowItWorksPhoneMockup,
  },
  {
    number: 2,
    title: "Restaurant manages everything from the web dashboard",
    description:
      "Floor plan, CRM, orders, and analytics. Your staff sees everything in real time.",
    mockup: HowItWorksDashboardMockup,
  },
  {
    number: 3,
    title: "AI learns and improves every shift",
    description:
      "No-show risk, lifetime value, shift briefings, and auto-tagging. Smarter every day.",
    mockup: HowItWorksAiBriefingMockup,
  },
];

export function LandingHowItWorks() {
  return (
    <SectionWithFade
      id="how-it-works"
      className="border-t border-border-dark/50 bg-background-dark py-20 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-xl">
        <div className="mb-3xl flex flex-col items-center text-center">
          <LandingSectionLabel>The process</LandingSectionLabel>
          <h2 className="text-4xl font-semibold tracking-tight-section text-text-on-dark">
            How it works
          </h2>
        </div>
        <LandingCardStagger
          className="flex flex-col items-stretch md:flex-row md:items-start"
          staggerDelayMs={100}
          flexChildren
        >
          {STEPS.map((step, index) => {
            const Mockup = step.mockup;
            return (
            <div key={step.number} className="flex flex-1 flex-col items-center">
              <div className="relative flex w-full flex-col items-center">
                {/* Watermark number */}
                <span
                  className="absolute -top-4 left-1/2 -translate-x-1/2 text-8xl font-extrabold text-text-on-dark opacity-5"
                  aria-hidden
                >
                  {String(step.number).padStart(2, "0")}
                </span>
                <div className="flex w-full items-center md:flex-row">
                  {index > 0 && (
                    <div className="hidden flex-1 border-t-2 border-dotted border-gold/60 md:block" />
                  )}
                  <div className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold text-xl font-bold text-text-on-gold">
                    {step.number}
                  </div>
                  {index < STEPS.length - 1 && (
                    <div className="hidden flex-1 border-t-2 border-dotted border-gold/60 md:block" />
                  )}
                </div>
              </div>
              <h3 className="mt-lg mb-sm text-center text-lg font-semibold text-text-on-dark">
                {step.title}
              </h3>
              <p className="text-center text-sm leading-relaxed text-text-muted-on-dark">
                {step.description}
              </p>
              <div className="mt-xl w-full">
                <Mockup />
              </div>
            </div>
            );
          })}
        </LandingCardStagger>
      </div>
    </SectionWithFade>
  );
}
