"use client";

import { SectionWithFade } from "./SectionWithFade";

const PAIN_POINTS = [
  {
    title: "Restaurants lose thousands to no-shows",
    description:
      "Every empty table is a missed opportunity. Without a way to predict and prevent no-shows, restaurants lose revenue and waste staff time.",
  },
  {
    title: "Staff never know who is walking in",
    description:
      "Guest preferences, allergies, and history live in scattered notes, spreadsheets, or nowhere at all. Your team is flying blind.",
  },
  {
    title: "Guest data lives nowhere permanent",
    description:
      "Reservations are forgotten. Order history never connects. Every visit starts from zero instead of building on the last.",
  },
];

export function AboutProblem() {
  return (
    <SectionWithFade
      id="problem"
      className="border-t border-border-dark/50 bg-surface-dark-alt py-20 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-xl">
        <h2 className="mb-3xl text-center text-3xl font-semibold tracking-tight-section text-text-on-dark">
          The Problem
        </h2>
        <div className="grid gap-xl md:grid-cols-3">
          {PAIN_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-lg border border-border-card bg-surface-dark p-xl"
            >
              <h3 className="mb-sm text-lg font-semibold text-text-on-dark">
                {point.title}
              </h3>
              <p className="text-sm leading-relaxed text-text-muted-on-dark">
                {point.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SectionWithFade>
  );
}
