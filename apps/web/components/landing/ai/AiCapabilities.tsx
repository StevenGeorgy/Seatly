"use client";

import { SectionWithFade } from "../SectionWithFade";

const CAPABILITIES = [
  {
    title: "Natural language CRM",
    description: "Answers questions about your guest database in plain English.",
  },
  {
    title: "Nightly shift briefings",
    description: "Generates a full briefing before every service.",
  },
  {
    title: "No-show prediction",
    description: "Scores every reservation for no-show risk.",
  },
  {
    title: "Lapsed guest suggestions",
    description: "Identifies who to reach out to and when.",
  },
  {
    title: "Slow night detection",
    description: "Flags quiet nights before they happen.",
  },
  {
    title: "Menu import from photos",
    description: "Scans and imports menus from photos.",
  },
];

export function AiCapabilities() {
  return (
    <SectionWithFade
      className="border-t border-border-dark/50 bg-surface-dark-alt py-20 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-xl">
        <h2 className="mb-3xl text-center text-4xl font-semibold tracking-tight-section text-text-on-dark">
          What Alex does
        </h2>
        <div className="grid gap-xl sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="rounded-lg border border-border-card bg-surface-dark p-xl"
            >
              <h3 className="text-lg font-semibold text-text-on-dark">
                {cap.title}
              </h3>
              <p className="mt-sm leading-relaxed text-text-muted-on-dark">
                {cap.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SectionWithFade>
  );
}
