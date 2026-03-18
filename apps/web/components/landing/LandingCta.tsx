"use client";

import Link from "next/link";
import { SectionWithFade } from "./SectionWithFade";

export function LandingCta() {
  return (
    <SectionWithFade className="border-t border-border-dark/50 bg-background-dark py-20 lg:py-32">
      <div className="mx-auto max-w-6xl px-xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight-section text-text-on-dark sm:text-4xl">
          Ready to transform your restaurant?
        </h2>
        <p className="mx-auto mt-lg max-w-xl leading-relaxed text-text-muted-on-dark">
          Join hundreds of restaurants already using Seatly to deliver a better experience.
        </p>
        <Link
          href="/signup"
          className="cta-shimmer mt-2xl inline-block rounded-md bg-gold px-2xl py-lg text-lg font-semibold text-text-on-gold transition-transform duration-400 hover:scale-[1.02] hover:bg-gold-muted"
        >
          Get Started Free
        </Link>
      </div>
    </SectionWithFade>
  );
}
