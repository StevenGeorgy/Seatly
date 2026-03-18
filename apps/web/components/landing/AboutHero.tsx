"use client";

import { SectionWithFade } from "./SectionWithFade";

export function AboutHero() {
  return (
    <SectionWithFade className="bg-background-dark pt-20 pb-32 lg:pt-32 lg:pb-40">
      <div className="mx-auto max-w-3xl px-xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight-hero text-text-on-dark sm:text-5xl lg:text-6xl">
          We built Seatly because restaurants deserve better software
        </h1>
        <p className="mx-auto mt-xl text-lg leading-relaxed text-text-muted-on-dark">
          Our mission is to give every restaurant the tools that used to be reserved
          for the biggest chains — real-time visibility, guest intelligence, and AI
          that actually helps.
        </p>
      </div>
    </SectionWithFade>
  );
}
