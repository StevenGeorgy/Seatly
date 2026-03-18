"use client";

import { SectionWithFade } from "../SectionWithFade";

export function FeaturesPageHero() {
  return (
    <SectionWithFade className="border-b border-border-dark/50 bg-background-dark py-20 lg:py-32">
      <div className="mx-auto max-w-6xl px-xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight-hero text-text-on-dark sm:text-5xl lg:text-6xl">
          Built for every corner of your restaurant
        </h1>
        <p className="mx-auto mt-xl max-w-2xl text-lg leading-relaxed text-text-muted-on-dark">
          From the floor to the kitchen to the front desk — everything your team needs, all in one place.
        </p>
      </div>
    </SectionWithFade>
  );
}
