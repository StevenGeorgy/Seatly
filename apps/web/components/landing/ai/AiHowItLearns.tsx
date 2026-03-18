"use client";

import { SectionWithFade } from "../SectionWithFade";

const STEPS = [
  {
    number: 1,
    title: "Every interaction counts",
    description: "Alex learns from every booking, every order, and every guest visit.",
  },
  {
    number: 2,
    title: "Patterns across shifts",
    description: "Identifies no-show risks, spending habits, and seasonal trends.",
  },
  {
    number: 3,
    title: "Gets smarter over time",
    description: "The more you use Seatly, the more accurate Alex becomes.",
  },
];

export function AiHowItLearns() {
  return (
    <SectionWithFade
      className="border-t border-border-dark/50 bg-background-dark py-20 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-xl">
        <h2 className="mb-3xl text-center text-4xl font-semibold tracking-tight-section text-text-on-dark">
          How Alex learns
        </h2>
        <div className="flex flex-col gap-2xl md:flex-row md:items-start md:justify-center">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="flex flex-1 flex-col items-center text-center"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold text-xl font-bold text-text-on-gold">
                {step.number}
              </div>
              <h3 className="mt-lg text-lg font-semibold text-text-on-dark">
                {step.title}
              </h3>
              <p className="mt-sm max-w-xs leading-relaxed text-text-muted-on-dark">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SectionWithFade>
  );
}
