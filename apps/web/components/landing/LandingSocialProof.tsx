"use client";

import { SectionWithFade } from "./SectionWithFade";

export function LandingSocialProof() {
  return (
    <SectionWithFade className="border-y border-border-dark/50 bg-surface-dark-alt py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-xl">
        <p className="mb-lg text-center text-sm font-medium text-text-muted-on-dark">
          Trusted by restaurants across Canada
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2xl text-center">
          <div>
            <p className="text-2xl font-bold text-gold">10,000+</p>
            <p className="text-sm text-text-muted-on-dark">covers managed</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-gold">500+</p>
            <p className="text-sm text-text-muted-on-dark">restaurants</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-gold">50,000+</p>
            <p className="text-sm text-text-muted-on-dark">bookings</p>
          </div>
        </div>
      </div>
    </SectionWithFade>
  );
}
