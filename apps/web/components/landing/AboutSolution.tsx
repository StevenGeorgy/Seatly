"use client";

import { SectionWithFade } from "./SectionWithFade";

const SOLUTIONS = [
  {
    problem: "Restaurants lose thousands to no-shows",
    solution:
      "Seatly uses AI to score every reservation for no-show risk. Your host can follow up before it happens.",
  },
  {
    problem: "Staff never know who is walking in",
    solution:
      "Every guest gets a permanent profile. Preferences, allergies, visit history, and AI insights — all in one place.",
  },
  {
    problem: "Guest data lives nowhere permanent",
    solution:
      "Reservations, orders, and visits all connect. Every interaction builds a richer picture of who your guests are.",
  },
];

export function AboutSolution() {
  return (
    <SectionWithFade
      id="solution"
      className="border-t border-border-dark/50 bg-background-dark py-20 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-xl">
        <h2 className="mb-3xl text-center text-3xl font-semibold tracking-tight-section text-text-on-dark">
          The Solution
        </h2>
        <div className="space-y-xl">
          {SOLUTIONS.map((item) => (
            <div
              key={item.problem}
              className="rounded-lg border border-border-card bg-surface-dark p-xl"
            >
              <p className="mb-sm text-sm text-text-muted-on-dark">{item.problem}</p>
              <p className="flex items-start gap-sm text-text-on-dark">
                <span className="text-gold">→</span>
                {item.solution}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SectionWithFade>
  );
}
