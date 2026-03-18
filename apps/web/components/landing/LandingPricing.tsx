"use client";

import { useState } from "react";
import Link from "next/link";
import { SectionWithFade } from "./SectionWithFade";
import { LandingSectionLabel } from "./LandingSectionLabel";

function GoldCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

const PRICING_CONFIG = {
  free: {
    name: "Free",
    priceMonthly: "$0",
    priceAnnual: "$0",
    period: "",
    description: "Get started with basic booking",
    features: ["Basic booking", "Up to 20 covers per day", "Email support"],
    cta: "Get Started Free",
    recommended: false,
  },
  starter: {
    name: "Starter",
    priceMonthly: "$49",
    priceAnnual: "$39",
    period: "/month",
    description: "Full CRM and analytics",
    features: ["Full CRM", "Analytics dashboard", "Unlimited covers", "Priority support"],
    cta: "Get Started",
    recommended: true,
  },
  pro: {
    name: "Pro",
    priceMonthly: "$149",
    priceAnnual: "$119",
    period: "/month",
    description: "AI features and voice receptionist",
    features: [
      "Everything in Starter",
      "AI features",
      "Voice AI receptionist (VAPI)",
      "Unlimited",
      "Dedicated support",
    ],
    cta: "Get Started",
    recommended: false,
  },
} as const;

const PLANS = [PRICING_CONFIG.free, PRICING_CONFIG.starter, PRICING_CONFIG.pro] as const;

export function LandingPricing() {
  const [isAnnual, setIsAnnual] = useState(false);

  return (
    <SectionWithFade id="pricing" className="border-t border-border-dark/50 bg-surface-dark-alt py-20 lg:py-32">
      <div className="mx-auto max-w-6xl px-xl">
        <div className="mb-3xl flex flex-col items-center text-center">
          <LandingSectionLabel>Pricing</LandingSectionLabel>
          <h2 className="text-4xl font-semibold tracking-tight-section text-text-on-dark">
            Simple, transparent pricing
          </h2>
        </div>
        <div className="mb-3xl flex items-center justify-center gap-md">
          <span
            className={`text-sm ${!isAnnual ? "font-semibold text-text-on-dark" : "text-text-muted-on-dark"}`}
          >
            Monthly
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isAnnual}
            onClick={() => setIsAnnual(!isAnnual)}
            className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-gold ${
              isAnnual ? "bg-gold" : "bg-border-dark"
            }`}
          >
            <span
              className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-400 ${
                isAnnual ? "left-7" : "left-1"
              }`}
            />
          </button>
          <span
            className={`text-sm ${isAnnual ? "font-semibold text-text-on-dark" : "text-text-muted-on-dark"}`}
          >
            Annual
          </span>
          <span className="rounded-full bg-gold/20 px-sm py-xs text-xs font-medium text-gold">
            Save 20%
          </span>
        </div>
        <div className="grid gap-xl md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-lg border p-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${
                plan.recommended
                  ? "border-gold bg-gold-tint shadow-gold-glow-pricing-card"
                  : "border-border-card bg-surface-dark"
              }`}
            >
              {plan.recommended && (
                <div className="absolute -right-px -top-px overflow-hidden">
                  <div className="absolute left-8 top-4 w-32 rotate-45 bg-gold py-xs text-center text-xs font-bold text-text-on-gold shadow-md">
                    Most Popular
                  </div>
                </div>
              )}
              <h3 className="text-lg font-semibold text-text-on-dark">{plan.name}</h3>
              <div className="mt-sm flex items-baseline gap-xs">
                <span className="text-6xl font-bold text-text-on-dark">
                  {isAnnual ? plan.priceAnnual : plan.priceMonthly}
                </span>
                <span className="text-text-muted-on-dark">{plan.period}</span>
              </div>
              <p className="mt-sm text-sm leading-relaxed text-text-muted-on-dark">
                {plan.description}
              </p>
              <ul className="mt-lg space-y-sm">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-sm text-sm text-text-on-dark"
                  >
                    <GoldCheckIcon className="h-5 w-5 shrink-0 text-gold" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`mt-xl block w-full rounded-md py-sm text-center font-semibold transition-transform duration-400 hover:scale-[1.02] ${
                  plan.recommended
                    ? "bg-gold text-text-on-gold hover:bg-gold-muted"
                    : "border border-gold text-gold hover:bg-gold/10"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </SectionWithFade>
  );
}
