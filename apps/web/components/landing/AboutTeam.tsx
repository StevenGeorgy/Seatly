"use client";

import { SectionWithFade } from "./SectionWithFade";

export function AboutTeam() {
  return (
    <SectionWithFade
      id="team"
      className="border-t border-border-dark/50 bg-surface-dark-alt py-20 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-xl">
        <h2 className="mb-3xl text-center text-3xl font-semibold tracking-tight-section text-text-on-dark">
          The Team
        </h2>
        <div className="flex flex-col items-center gap-2xl">
          <div className="flex flex-wrap justify-center gap-xl">
            {["FT", "FT", "FT"].map((initials, i) => (
              <div
                key={i}
                className="flex flex-col items-center gap-sm"
              >
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-gold/30 bg-gold/10 text-xl font-bold text-gold">
                  {initials}
                </div>
                <p className="text-sm font-medium text-text-on-dark">Founding Team</p>
              </div>
            ))}
          </div>
          <p className="max-w-md text-center text-sm text-text-muted-on-dark">
            We&apos;re a small team building the future of restaurant software.
          </p>
          <a
            href="#"
            className="rounded-md border border-gold px-2xl py-lg text-base font-semibold text-gold transition-colors hover:bg-gold/10"
          >
            We are hiring
          </a>
        </div>
      </div>
    </SectionWithFade>
  );
}
