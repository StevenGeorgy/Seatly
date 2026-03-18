"use client";

import { SectionWithFade } from "../SectionWithFade";

export function AiPageHero() {
  return (
    <SectionWithFade className="bg-background-dark pt-20 pb-24 lg:pt-32 lg:pb-40">
      <div className="mx-auto max-w-6xl px-xl">
        <div className="flex flex-col items-center text-center">
          {/* Large gold A avatar - Alex character */}
          <div
            className="mb-xl flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-gold bg-gold/10 text-5xl font-extrabold text-gold shadow-gold-glow lg:mb-2xl lg:h-32 lg:w-32 lg:text-6xl"
            aria-hidden
          >
            A
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight-hero text-text-on-dark sm:text-5xl lg:text-6xl">
            Meet Alex — Your Restaurant&apos;s AI Assistant
          </h1>
          <p className="mx-auto mt-xl max-w-2xl text-lg leading-relaxed text-text-muted-on-dark">
            Alex lives inside Seatly. He knows every guest, every shift, and every
            table. Ask him anything.
          </p>
        </div>
      </div>
    </SectionWithFade>
  );
}
