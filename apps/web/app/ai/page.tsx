"use client";

import Link from "next/link";
import { LandingNavbar, LandingFooter } from "@/components/landing";
import { LandingAiChatDemo } from "@/components/landing/LandingAiChatDemo";
import { SectionWithFade } from "@/components/landing/SectionWithFade";
import { AiPageHero } from "@/components/landing/ai/AiPageHero";
import { AiCapabilities } from "@/components/landing/ai/AiCapabilities";
import { AiHowItLearns } from "@/components/landing/ai/AiHowItLearns";
import { AiPrivacy } from "@/components/landing/ai/AiPrivacy";
import { AiCta } from "@/components/landing/ai/AiCta";

export default function AiPage() {
  return (
    <div className="min-h-screen bg-background-dark">
      <LandingNavbar />
      <main>
        <AiPageHero />
        <AiCapabilities />
        <SectionWithFade className="border-t border-border-dark/50 bg-surface-dark-alt py-24 lg:py-32">
          <div className="mx-auto max-w-6xl px-xl">
            <div className="mb-3xl flex flex-col items-center text-center">
              <h2 className="text-4xl font-semibold tracking-tight-section text-text-on-dark">
                Alex in action
              </h2>
              <p className="mx-auto mt-lg max-w-2xl leading-relaxed text-text-muted-on-dark">
                Ask Alex anything about your restaurant. Natural language, instant answers.
              </p>
            </div>
            <div className="mx-auto max-w-2xl">
              <LandingAiChatDemo variant="ai-page" />
            </div>
          </div>
        </SectionWithFade>
        <AiHowItLearns />
        <AiPrivacy />
        <AiCta />
      </main>
      <LandingFooter />
    </div>
  );
}
