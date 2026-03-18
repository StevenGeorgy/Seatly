"use client";

import Link from "next/link";
import { SectionWithFade } from "../SectionWithFade";

export function AiCta() {
  return (
    <SectionWithFade
      className="border-t border-border-dark/50 bg-background-dark py-20 lg:py-32"
    >
      <div className="mx-auto max-w-3xl px-xl text-center">
        <Link
          href="/signup"
          className="cta-shimmer inline-block rounded-md bg-gold px-2xl py-lg text-lg font-semibold text-text-on-gold transition-transform duration-400 hover:scale-[1.02] hover:bg-gold-muted"
        >
          Try Seatly and meet Alex
        </Link>
      </div>
    </SectionWithFade>
  );
}
