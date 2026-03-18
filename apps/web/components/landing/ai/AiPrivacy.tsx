"use client";

import { SectionWithFade } from "../SectionWithFade";

export function AiPrivacy() {
  return (
    <SectionWithFade
      className="border-t border-border-dark/50 bg-surface-dark-alt py-20 lg:py-32"
    >
      <div className="mx-auto max-w-3xl px-xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight-section text-text-on-dark">
          Privacy and control
        </h2>
        <p className="mt-xl text-lg leading-relaxed text-text-muted-on-dark">
          Alex only knows what is in your Seatly account. No data leaves your
          restaurant.
        </p>
      </div>
    </SectionWithFade>
  );
}
